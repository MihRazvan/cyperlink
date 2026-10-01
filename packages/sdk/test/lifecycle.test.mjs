import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { INITIAL_PROFILE as P, publicKeyAddress as address, publicKeyBytes as bytes, decodeJob, decodeQuota,
  reconcileOperation, LocalRpcTransport, OperationReader } from '../src/index.mjs';
const hash = (...parts) => createHash('sha256').update(Buffer.concat(parts)).digest();
const key = n => address(Buffer.alloc(32, n));
function fixture() {
  const owner = key(7), admin = key(8), effect = key(9), computation = key(10), permitAddress = key(11), jobAddress = key(12);
  const quota = Buffer.alloc(161); quota[128] = 1; bytes(admin).copy(quota, 96); quota[56] = 9;
  hash(quota.subarray(40, 88)).copy(quota, 8);
  const template = Buffer.alloc(520); quota.subarray(8, 40).copy(template, 16);
  for (const [offset, value] of [[80, key(13)], [112, key(14)], [144, key(15)], [176, owner], [368, P.quota], [400, P.merchant]]) bytes(value).copy(template, offset);
  const sku = Buffer.alloc(8); sku.writeBigUInt64LE(42n);
  hash(Buffer.from('merchant-purchase-v1'), bytes(effect), sku, bytes(owner), template.subarray(144, 176), template.subarray(112, 144)).copy(template, 432);
  template.writeBigUInt64LE(2n, 464); template.writeBigUInt64LE(100n, 512);
  const inputs = Buffer.alloc(32, 16), job = Buffer.alloc(1024);
  hash(Buffer.from('account:Job')).subarray(0, 8).copy(job); job[8] = 1;
  bytes(owner).copy(job, 10); bytes(computation).copy(job, 42); bytes(permitAddress).copy(job, 74);
  template.subarray(464, 480).copy(job, 106); template.subarray(512, 520).copy(job, 122); template.copy(job, 130); inputs.copy(job, 650);
  const permit = Buffer.alloc(520), entitlement = Buffer.alloc(49);
  const operation = { profile: P.name, job: jobAddress, computation, permit: permitAddress, owner, admin, quota: P.quota,
    effect, sku: '42', templateHex: template.toString('hex'), inputsHashHex: inputs.toString('hex') };
  const account = (address, owner, data) => ({ address, owner, executable: false, data });
  const snapshot = { slot: 20, commitment: 'finalized', accounts: [account(jobAddress, P.auth, job),
    account(permitAddress, P.policy, permit), account(P.quota, P.policy, quota), account(effect, P.merchant, entitlement)] };
  const authorize = () => { job[9] = 1; template.copy(permit); permit[1] = 1; permit[480] = 19; hash(permit.subarray(464, 512)).copy(permit, 48); };
  const commit = () => { authorize(); permit[0] = 2; quota.writeBigUInt64LE(1n); permit.subarray(48, 80).copy(quota, 8); permit.subarray(464, 512).copy(quota, 40);
    entitlement.write('PURCH001'); bytes(owner).copy(entitlement, 8); entitlement.writeBigUInt64LE(42n, 40); entitlement[48] = 1; };
  return { operation, snapshot, job, permit, quota, entitlement, authorize, commit };
}
test('callback authorization is not a paid entitlement', () => {
  const f = fixture(); assert.equal(reconcileOperation(f.operation, f.snapshot).status, 'queued');
  f.authorize(); const status = reconcileOperation(f.operation, f.snapshot);
  assert.equal(status.status, 'authorized'); assert(status.actions.includes('submit-owner-signed-commit'));
  assert.equal(f.entitlement[48], 0);
});
test('only complete exact bound effects establish commit, including after later quota advances', () => {
  const f = fixture(); f.commit(); assert.equal(reconcileOperation(f.operation, f.snapshot).status, 'committed');
  f.quota.writeBigUInt64LE(2n); f.quota[56] ^= 1; hash(f.quota.subarray(40, 88)).copy(f.quota, 8);
  assert.equal(reconcileOperation(f.operation, f.snapshot).status, 'committed');
});
test('reject partial atomic effects and wrong successor', () => {
  for (const mutate of [f => f.entitlement.fill(0), f => { f.permit[0] = 0; }, f => { f.quota.writeBigUInt64LE(0n); },
    f => { f.quota[56] ^= 1; hash(f.quota.subarray(40, 88)).copy(f.quota, 8); }]) {
    const f = fixture(); f.commit(); mutate(f); assert.throws(() => reconcileOperation(f.operation, f.snapshot));
  }
});
test('stale authorization and expiry require explicit new authorization, never implicit recomputation', () => {
  const f = fixture(); f.authorize(); f.quota.writeBigUInt64LE(1n);
  assert.equal(reconcileOperation(f.operation, f.snapshot).status, 'stale');
  f.snapshot.slot = 101;
  const observed = reconcileOperation(f.operation, f.snapshot); assert.equal(observed.status, 'expired');
  assert.deepEqual(observed.actions, ['cancel-with-owner', 'prepare-fresh-with-owner-and-admin']);
});
test('denial, invalidation and cancellation preserve distinct states', () => {
  for (const [code, status] of [[2, 'denied'], [4, 'invalidated'], [3, 'cancelled']]) {
    const f = fixture(); f.job[9] = code; if (code === 3) f.permit[0] = 3;
    assert.equal(reconcileOperation(f.operation, f.snapshot).status, status);
  }
  const f = fixture(); f.authorize(); f.job[9] = 3; f.permit[0] = 3;
  assert.equal(reconcileOperation(f.operation, f.snapshot).status, 'cancelled');
});
test('reject forged ownership, wrong addresses, changed bindings, malformed Job and persisted intermediate route', () => {
  for (const mutate of [f => f.snapshot.accounts[0].owner = P.policy, f => f.snapshot.accounts[1].address = key(99),
    f => f.job[0] ^= 1, f => f.job[650] ^= 1, f => f.job[130 + 80] ^= 1, f => f.job[42] ^= 1,
    f => f.quota[129] = 1, f => f.snapshot.accounts[0].executable = true,
    f => f.operation.sku = '43', f => f.operation.effect = key(99)]) {
    const f = fixture(); mutate(f); assert.throws(() => reconcileOperation(f.operation, f.snapshot));
  }
  const f = fixture(); assert.throws(() => decodeJob(f.job.subarray(0, 682)));
  assert.throws(() => decodeQuota(f.quota.subarray(0, 129)), /layout/);
});
test('absent Job never means a sent transaction has failed', () => {
  const f = fixture(); f.snapshot.accounts[0] = null;
  assert.equal(reconcileOperation(f.operation, f.snapshot).status, 'unobserved');
  f.commit(); assert.throws(() => reconcileOperation(f.operation, f.snapshot), /absent/);
});
test('observations preserve monotonically increasing RPC context slots', async () => {
  const f = fixture(); let minimum;
  const reader = new OperationReader({ async readAccounts(keys, options) {
    assert.deepEqual(keys, [f.operation.job, f.operation.permit, f.operation.quota, f.operation.effect]);
    minimum = options.minContextSlot; return f.snapshot;
  } });
  await reader.observe(f.operation); assert.equal(minimum, undefined);
  f.snapshot.slot = 21; await reader.observe(f.operation); assert.equal(minimum, 20);
  f.snapshot.slot = 19; await assert.rejects(reader.observe(f.operation), /regressed/);
});
test('local RPC rejects public endpoints and requests one consistent account batch', async () => {
  for (const url of ['https://api.mainnet-beta.solana.com', 'http://127.0.0.1.evil.test', 'file:///tmp/rpc', 'http://user:pass@localhost']) assert.throws(() => new LocalRpcTransport(url));
  const f = fixture(); let captured;
  const transport = new LocalRpcTransport('http://127.0.0.1:8899', { fetch: async (url, options) => {
    captured = JSON.parse(options.body); assert.equal(options.redirect, 'error');
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: { context: { slot: 20 }, value: f.snapshot.accounts.map(a => ({ owner: a.owner, executable: false, data: [a.data.toString('base64'), 'base64'] })) } }) };
  } });
  const reader = new OperationReader(transport); assert.equal((await reader.observe(f.operation)).status, 'queued');
  assert.equal(captured.method, 'getMultipleAccounts'); assert.equal(captured.params[1].commitment, 'finalized');
  await assert.rejects(transport.readAccounts(captured.params[0], { minContextSlot: 21 }), /predates/);
});
