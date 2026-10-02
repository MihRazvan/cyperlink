import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { loadWeb3, REPO } from '../packages/local-client/src/runtime.mjs';
import { INITIAL_PROFILE as P, buildActionTemplate, buildMerchantDigest, publicKeyBytes } from '../packages/sdk/src/index.mjs';
import { hash, le, queryStateDigest } from '../packages/local-client/src/operation-plan.mjs';
import { verifyQuerySnapshotRejection, verifyPreparedActionRecovery, reviewRecoveryArchive } from '../scripts/verify_recovery_archive.mjs';
const moduleRoot = process.env.CYPERLINK_JS_MODULE_ROOT ?? resolve(REPO, '.local/toolchain/js');
const web3 = await loadWeb3(moduleRoot);
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

test('top-level compatible archive verifies retained worker without conflict-only rejection', async t => {
  // Synthetic host serialization fixture: no native proof, RPC execution, or real payment claim.
  await mkdir(resolve(REPO, '.local'), { recursive: true });
  const directory = await mkdtemp(resolve(REPO, '.local/recovery-compatible-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { plan: partial } = fixture(), quota = Buffer.from(partial.quotaSnapshotHex, 'hex');
  const descriptor = { ...partial.descriptor, profile: P.name, consumerKind: 'merchant', owner: key(5), admin: key(4), effect: key(9), sku: '7' };
  const binding = { sourceDataHex: '01', nativeDataHex: '02', proofAddresses: [key(11), key(12), key(13)], proofDataHex: ['03', '04', '05'] };
  const query = { offset: '29', expiry: '100', publicKeyHex: '15'.repeat(32), clientNonceHex: '16'.repeat(16), amountCiphertextHex: '17'.repeat(32), openingCiphertextHex: '18'.repeat(32) };
  const digest = buildMerchantDigest({ effect: publicKeyBytes(descriptor.effect), sku: '7', owner: publicKeyBytes(descriptor.owner), destination: publicKeyBytes(key(8)), mint: publicKeyBytes(key(7)) });
  const template = Buffer.alloc(520);
  buildActionTemplate({ source: publicKeyBytes(key(6)), mint: publicKeyBytes(key(7)), destination: publicKeyBytes(key(8)), owner: publicKeyBytes(descriptor.owner),
    sourceData: Buffer.from('01', 'hex'), nativeData: Buffer.from('02', 'hex'), proofKeys: binding.proofAddresses.map(publicKeyBytes), proofData: binding.proofDataHex.map(value => Buffer.from(value, 'hex')),
    newSource: Buffer.alloc(64, 7), commitment: Buffer.alloc(32, 8), quota: publicKeyBytes(P.quota), consumer: publicKeyBytes(P.merchant), consumerContract: digest }).copy(template);
  quota.subarray(8, 40).copy(template, 16); le(3n, 16).copy(template, 464); le(100n).copy(template, 512);
  Object.assign(descriptor, { templateHex: template.toString('hex'), queryStateHashHex: queryStateDigest(quota).toString('hex'),
    inputsHashHex: hash(...['publicKeyHex', 'clientNonceHex', 'amountCiphertextHex', 'openingCiphertextHex'].map(name => Buffer.from(query[name], 'hex')), quota.subarray(40, 88), le(3n, 16), template.subarray(336, 368)).toString('hex') });
  const plan = { schema: 1, contextSlot: 1, label: 'host-recovery', action: key(19), genesisHash: key(20), mxePublicKeyHex: '19'.repeat(32), quotaSnapshotHex: quota.toString('hex'), descriptor, binding, query };
  const actionBytes = Buffer.alloc(1200);
  hash(Buffer.from('account:PreparedAction')).subarray(0, 8).copy(actionBytes);
  publicKeyBytes(descriptor.owner).copy(actionBytes, 8);
  template.subarray(80, 464).copy(actionBytes, 120);
  const native = Buffer.from(binding.nativeDataHex, 'hex');
  actionBytes.writeUInt32LE(native.length, 504); native.copy(actionBytes, 508);
  const preparedAction = { address: plan.action, owner: P.auth, executable: false, slot: 2,
    dataBase64: actionBytes.toString('base64'), sha256: hash(actionBytes).toString('hex') };
  const record = { role: 'query', minContextSlot: 1 };
  const recovery = { delivery: { semanticBinding: { preparedAction } }, observation: { slot: 3 } };
  assert.deepEqual(verifyPreparedActionRecovery(plan, record, recovery), preparedAction);
  assert.throws(() => verifyPreparedActionRecovery(plan, record, { ...recovery, delivery: {} }), /requires immutable PreparedAction/);
  assert.throws(() => verifyPreparedActionRecovery(plan, { ...record, minContextSlot: 3 }, recovery), /predates signed ticket/);
  // Immutable action evidence has its own floor; it need not predate the operation observation.
  assert.deepEqual(verifyPreparedActionRecovery(plan, record, { ...recovery, observation: { slot: 1 } }), preparedAction);
  const changed = Buffer.from(actionBytes); changed[508] ^= 1;
  const changedRecovery = structuredClone(recovery);
  Object.assign(changedRecovery.delivery.semanticBinding.preparedAction, { dataBase64: changed.toString('base64'), sha256: hash(changed).toString('hex') });
  assert.throws(() => verifyPreparedActionRecovery(plan, record, changedRecovery), /native/i);
  const planBytes = Buffer.from(JSON.stringify(plan));
  await mkdir(resolve(directory, 'operation-host-recovery'));
  await writeFile(resolve(directory, 'operation-host-recovery/operation-plan.json'), planBytes);
  const worker = { passed: true, action: 'observe', processId: 123, genesisHash: plan.genesisHash,
    generatesKeysProofsOrOperationIdentity: false, createsNewSignedTransaction: false,
    retainedPlan: { bytes: planBytes.length, sha256: hash(planBytes).toString('hex') },
    identity: Object.fromEntries(['job', 'computation', 'permit', 'owner', 'quota', 'effect'].map(name => [name, descriptor[name]])), observation: { status: 'authorized', slot: 2 } };
  await writeFile(resolve(directory, 'recovery-host-observe.json'), JSON.stringify(worker));
  const results = { passed: true, scenario: 'compatible', genesis_hash: plan.genesisHash, operations: [{ label: plan.label }], recoveries: [{ label: 'host-observe', ...worker }], transactions: [] };
  const resultsPath = resolve(directory, 'results.json'), options = { resultsPath, moduleRoot };
  await writeFile(resultsPath, JSON.stringify(results));
  const report = await reviewRecoveryArchive(options);
  assert.equal(report.passed, true); assert.equal(report.scenario, 'compatible'); assert.equal(report.counts.workers, 1);
  assert.equal(report.querySnapshotRejection.expected, false);
  results.recoveries[0].retainedPlan.sha256 = '00'.repeat(32);
  await writeFile(resultsPath, JSON.stringify(results));
  await assert.rejects(reviewRecoveryArchive(options), /Embedded worker result changed/);
  results.recoveries[0].retainedPlan.sha256 = hash(planBytes).toString('hex'); results.scenario = 'conflict';
  await writeFile(resultsPath, JSON.stringify(results));
  await assert.rejects(reviewRecoveryArchive(options), /Conflict scenario requires actual/);
});
