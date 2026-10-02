import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { loadWeb3, REPO } from '../packages/local-client/src/runtime.mjs';
import { INITIAL_PROFILE as P } from '../packages/sdk/src/index.mjs';
import { verifyQuerySnapshotRejection } from '../scripts/verify_recovery_archive.mjs';
const web3 = await loadWeb3(process.env.CYPERLINK_JS_MODULE_ROOT ?? resolve(REPO, '.local/toolchain/js'));
const key = n => new web3.PublicKey(Buffer.alloc(32, n)).toBase58();
function fixture() {
  const descriptor = { quota: P.quota, permit: key(3), job: key(1), computation: key(2) };
  const claim = web3.PublicKey.findProgramAddressSync([Buffer.from('permit-claim'), new web3.PublicKey(descriptor.permit).toBuffer()], new web3.PublicKey(P.auth))[0].toBase58();
  const before = Buffer.alloc(161); before[128] = 1; new web3.PublicKey(key(4)).toBuffer().copy(before, 96); before[40] = 1;
  createHash('sha256').update(before.subarray(40, 88)).digest().copy(before, 8); before.writeBigUInt64LE(2n, 88);
  const plan = { descriptor, quotaSnapshotHex: before.toString('hex') }, current = Buffer.from(before); current.writeBigUInt64LE(3n, 88);
  const account = (address, data) => ({ address, owner: P.policy, executable: false, lamports: 1, dataBase64: data.toString('base64') });
  const snapshot = { slot: 10, accounts: [account(P.quota, current), account(descriptor.permit, Buffer.alloc(520)), null, null, null] };
  const results = { callbacks: [], transactions: [{ signature: 'signature', slot: 11, transaction: { meta: { err: { InstructionError: [1, { Custom: 6004 }] } } } }],
    querySnapshotRejection: { descriptor, actualCustomError: 6004, signature: 'signature', trackedAddresses: [P.quota, descriptor.permit, descriptor.job, descriptor.computation, claim],
      before: snapshot, after: { ...structuredClone(snapshot), slot: 12 } } };
  return { plan, results };
}

test('counter-only rejection checks actual receipt and raw absent/unchanged accounts', () => {
  const f = fixture(), review = verifyQuerySnapshotRejection(f.results, f.plan, web3);
  assert.equal(review.retainedCounter, '2'); assert.equal(review.currentCounter, '3');
  assert.equal(review.currentVersion, '0'); assert.equal(review.absentJobComputationClaim, 3);
});

test('missing-account assertion cannot hide a created Job or mutated permit', () => {
  for (const index of [1, 2, 3, 4]) {
    const f = fixture(); f.results.querySnapshotRejection.after.accounts[index] = { address: key(8), dataBase64: 'AQ==' };
    assert.throws(() => verifyQuerySnapshotRejection(f.results, f.plan, web3), /mutated tracked state/);
  }
});

test('counter-only test rejects settled version drift and unchanged counter', () => {
  for (const mutate of [data => data.writeBigUInt64LE(1n, 0), data => data.writeBigUInt64LE(2n, 88)]) {
    const f = fixture(), account = f.results.querySnapshotRejection.before.accounts[0], data = Buffer.from(account.dataBase64, 'base64');
    mutate(data); account.dataBase64 = data.toString('base64'); f.results.querySnapshotRejection.after = structuredClone(f.results.querySnapshotRejection.before);
    assert.throws(() => verifyQuerySnapshotRejection(f.results, f.plan, web3));
  }
});

test('wrong rejection cause, substituted absent addresses, and disclosed callback fail review', () => {
  for (const mutate of [f => f.results.transactions[0].transaction.meta.err.InstructionError[1].Custom = 803,
    f => f.results.querySnapshotRejection.trackedAddresses[2] = key(9),
    f => f.results.callbacks.push({ job: f.plan.descriptor.job })]) {
    const f = fixture(); mutate(f); assert.throws(() => verifyQuerySnapshotRejection(f.results, f.plan, web3));
  }
});
