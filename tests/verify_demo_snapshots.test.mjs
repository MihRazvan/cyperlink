// Synthetic retained-receipt/account structures test offline verification only.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyAccountSnapshots } from '../scripts/verify_demo_snapshots.mjs';
import { INITIAL_PROFILE as P, publicKeyAddress as address, publicKeyBytes as bytes } from '../packages/sdk/src/index.mjs';
const TOKEN = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const key = n => address(Buffer.alloc(32, n));
const sha = data => createHash('sha256').update(data).digest();
const clone = value => structuredClone(value);
function evidence(scenario = 'conflict') {
  const a = { label: 'a60', source: key(1), destination: key(2), permit: key(3), record: key(4), consumer: P.merchant, kind: 'merchant' };
  const b = { label: 'b60-stale', source: key(5), destination: key(6), permit: key(7), record: key(8), consumer: P.license, kind: 'license' };
  const state = new Map(), result = { scenario, operations: [a, b], transactions: [], accountSnapshots: [] };
  const put = (address, owner, data) => state.set(address, { address, owner, executable: false, lamports: 10000, dataBase64: data.toString('base64') });
  const q = Buffer.alloc(161); q[128] = 1; q[56] = 9; sha(q.subarray(40, 88)).copy(q, 8); put(P.quota, P.policy, q);
  for (const op of [a, b]) {
    put(op.source, TOKEN, Buffer.alloc(470, 3)); put(op.destination, TOKEN, Buffer.alloc(470, 4));
    const p = Buffer.alloc(520); p[1] = 1; q.subarray(8, 40).copy(p, 16); p.fill(7, 464, 512); sha(p.subarray(464, 512)).copy(p, 48);
    put(op.permit, P.policy, p); put(op.record, op.consumer, Buffer.alloc(op.kind === 'merchant' ? 49 : 81));
  }
  put(key(20), P.merchant, Buffer.alloc(49)); put(key(21), P.license, Buffer.alloc(81));
  let slot = 20;
  function receipt(op, label, code, changes = {}, commit = false) {
    const dest = changes.destination ?? op.destination, record = changes.record ?? op.record, consumer = changes.consumer ?? op.consumer;
    const keys = [op.permit, P.quota, key(30), P.policy, TOKEN, op.source, key(31), dest, key(32), key(33), key(34), key(35), key(36), consumer, key(37), key(38), record];
    const data = Buffer.alloc(consumer === P.merchant ? 11 : 43); data[0] = consumer === P.merchant ? 1 : 2; data[1] = 7;
    const entry = { label, slot, signature: 'synthetic-test-receipt-' + slot, transaction: { slot,
      meta: { err: code ? { InstructionError: [1, { Custom: code }] } : null, logMessages: code === 1099 ? [`Program ${TOKEN} success`] : [] },
      transaction: { message: { staticAccountKeys: keys, compiledInstructions: [{ programIdIndex: 13, accountKeyIndexes: keys.map((_, i) => i), data: { type: 'Buffer', data: [...data] } }], addressTableLookups: [] } } } };
    result.transactions.push(entry);
    const tracked = [...new Set([op.source, op.destination, dest, op.permit, P.quota, op.record, record])];
    const prefix = commit ? op.label + '-commit' : label;
    result.accountSnapshots.push({ label: prefix + '-before', commitment: 'confirmed', context: { slot: slot - 1 }, accounts: tracked.map(k => clone(state.get(k))) });
    if (commit) {
      for (const target of [op.source, op.destination]) { const raw = Buffer.from(state.get(target).dataBase64, 'base64'); raw[1] ^= 1; put(target, TOKEN, raw); }
      const p = Buffer.from(state.get(op.permit).dataBase64, 'base64'); p[0] = 2; put(op.permit, P.policy, p);
      const next = Buffer.from(state.get(P.quota).dataBase64, 'base64'); next.writeBigUInt64LE(next.readBigUInt64LE(0) + 1n); p.subarray(48, 80).copy(next, 8); p.subarray(464, 512).copy(next, 40); put(P.quota, P.policy, next);
      const effect = Buffer.alloc(consumer === P.merchant ? 49 : 81); effect.write(consumer === P.merchant ? 'PURCH001' : 'LICENSE1'); bytes(keys[11]).copy(effect, 8); data.subarray(1, consumer === P.merchant ? 9 : 41).copy(effect, 40); effect[effect.length - 1] = 1; put(op.record, consumer, effect);
    }
    result.accountSnapshots.push({ label: prefix + '-after', commitment: 'confirmed', context: { slot }, accounts: tracked.map(k => clone(state.get(k))) });
    slot++;
  }
  if (scenario === 'compatible') {
    receipt(a, 'a60-atomic-paid-entitlement', null, {}, true);
    const current = Buffer.from(state.get(P.quota).dataBase64, 'base64'), freshPermit = Buffer.from(state.get(b.permit).dataBase64, 'base64');
    current.subarray(0, 8).copy(freshPermit, 8); current.subarray(8, 40).copy(freshPermit, 16);
    freshPermit.fill(17, 464, 512); sha(freshPermit.subarray(464, 512)).copy(freshPermit, 48); put(b.permit, P.policy, freshPermit);
    receipt(b, 'b60-stale-atomic-paid-entitlement', null, {}, true);
    return result;
  }
  receipt(a, 'changed-destination-binding-rejected', 705, { destination: b.destination });
  receipt(a, 'changed-application-action-binding-rejected', 705, { record: key(20) });
  receipt(a, 'changed-consumer-binding-rejected', 705, { record: key(21), consumer: P.license });
  receipt(a, 'post-native-transfer-merchant-failure-rolls-back', 1099);
  receipt(a, 'a60-atomic-paid-entitlement', null, {}, true);
  receipt(b, 'competing-license-stale-authorization', 803);
  receipt(a, 'consumed-merchant-entitlement-replay', 1001);
  return result;
}
const after = e => e.accountSnapshots[1];
const mutateBytes = (account, change) => { const data = Buffer.from(account.dataBase64, 'base64'); change(data); account.dataBase64 = data.toString('base64'); };

test('independently compares all rejected account bytes/metadata and exact paid successor', () => {
  const checked = verifyAccountSnapshots(evidence(), { required: true });
  assert.equal(checked.snapshotCount, 14); assert.equal(checked.rejectedTransactions, 6); assert.equal(checked.rejectedAccountComparisons, 33);
  assert.equal(checked.commits.length, 1); assert.equal(checked.commits[0].changedAccounts, 5);
});
test('rejects changed rejection bytes, lamports, owner, flags and malformed base64', () => {
  for (const mutate of [a => mutateBytes(a, data => { data[0] ^= 1; }), a => a.lamports++, a => a.owner = P.policy,
    a => a.executable = true, a => a.dataBase64 += '!']) {
    const e = evidence(); mutate(after(e).accounts[0]); assert.throws(() => verifyAccountSnapshots(e));
  }
});
test('account-set binding rejects dropped altered targets, replacement keys and duplicate accounts', () => {
  for (const mutate of [e => { e.accountSnapshots[0].accounts.splice(2, 1); after(e).accounts.splice(2, 1); },
    e => after(e).accounts[0].address = key(99), e => after(e).accounts.push(after(e).accounts[0])]) {
    const e = evidence(); mutate(e); assert.throws(() => verifyAccountSnapshots(e));
  }
});
test('rejects missing/duplicate snapshot pairs and a required-snapshot downgrade', () => {
  for (const mutate of [e => e.accountSnapshots.pop(), e => e.accountSnapshots.push(e.accountSnapshots[0]),
    e => { delete e.accountSnapshots; }, e => e.accountSnapshots = []]) {
    const e = evidence(); mutate(e); assert.throws(() => verifyAccountSnapshots(e, { required: true }));
  }
  const old = evidence(); delete old.accountSnapshots; assert.equal(verifyAccountSnapshots(old).available, false);
});
test('slots must bracket the matching failure receipt and remain monotonic', () => {
  for (const mutate of [e => e.accountSnapshots[0].context.slot = 21, e => after(e).context.slot = 19,
    e => e.transactions[0].transaction.slot++, e => e.transactions[0].transaction.meta.err.InstructionError[1].Custom = 9999,
    e => e.accountSnapshots[2].context.slot = 1]) {
    const e = evidence(); mutate(e); assert.throws(() => verifyAccountSnapshots(e));
  }
});
test('successful snapshot must contain exact authorized successor and signed application effect', () => {
  for (const mutate of [e => { const pair = e.accountSnapshots.filter(s => s.label.startsWith('a60-commit')); pair[1].accounts[0] = clone(pair[0].accounts[0]); },
    e => { const effect = e.accountSnapshots.find(s => s.label === 'a60-commit-after').accounts.find(a => a.address === key(4)); mutateBytes(effect, data => { data[40] ^= 1; }); },
    e => { const quota = e.accountSnapshots.find(s => s.label === 'a60-commit-after').accounts.find(a => a.address === P.quota); mutateBytes(quota, data => { data[56] ^= 1; sha(data.subarray(40, 88)).copy(data, 8); }); },
    e => { const quota = after(e).accounts.find(a => a.address === P.quota); mutateBytes(quota, data => { data[129] = 1; }); }]) {
    const e = evidence(); mutate(e); assert.throws(() => verifyAccountSnapshots(e));
  }
});

test('compatible archive verifies both merchant and license commit effects', () => {
  const result = evidence('compatible'), checked = verifyAccountSnapshots(result, {required:true});
  assert.equal(checked.snapshotCount, 4); assert.equal(checked.commits.length, 2); assert.equal(checked.rejectedTransactions, 0);
  const forged = clone(result); const record = forged.accountSnapshots.at(-1).accounts.find(a => a.address === key(8));
  mutateBytes(record, data => { data[72] ^= 1; }); assert.throws(() => verifyAccountSnapshots(forged));
});
