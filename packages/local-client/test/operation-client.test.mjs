import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { LocalOperationClient } from '../src/operation-client.mjs';
import { hash, le, queryStateDigest, validateOperationPlan } from '../src/operation-plan.mjs';
import { INITIAL_PROFILE as P, publicKeyBytes as bytes, buildActionTemplate, buildMerchantDigest, buildLicenseDigest } from '../../sdk/src/index.mjs';
import { TOKEN_PROGRAM } from '../src/runtime.mjs';

const require = createRequire(resolve(process.env.CYPERLINK_JS_MODULE_ROOT ?? '.local/toolchain/js', 'package.json'));
const web3 = require('@solana/web3.js'), BN = require('bn.js'), arcium = require('@arcium-hq/client');
const { PublicKey, Keypair } = web3;
const key = n => new PublicKey(Buffer.alloc(32, n));

// Host mocks only: no validator/RPC, no native proof verification, no MPC execution.
function fixture(kind = 'merchant') {
  const owner = Keypair.fromSeed(Buffer.alloc(32, 1)), payer = Keypair.fromSeed(Buffer.alloc(32, 2));
  const calls = { staged: [], fetched: [], query: [] }, genesis = key(3).toBase58();
  const quota = Buffer.alloc(161); quota[128] = 1; payer.publicKey.toBuffer().copy(quota, 96);
  quota[56] = 17; hash(quota.subarray(40, 88)).copy(quota, 8); quota.writeBigUInt64LE(3n, 88);
  const runtimeKey = Buffer.alloc(32, 4);
  const state = { genesis, quota, runtimeKey, action: null, actionFetches: 0 };
  const connection = {
    async getGenesisHash() { return state.genesis; },
    async getAccountInfo(address) { calls.fetched.push(address.toBase58()); return { owner: new PublicKey(P.policy), data: state.quota }; },
  };
  const program = { programId: new PublicKey(P.auth), account: { preparedAction: { async fetch(address) {
    state.actionFetches++; assert.equal(address.toBase58(), key(5).toBase58()); return state.action;
  } } }, methods: { runtimeBudgetBound(...args) {
    const capture = { args }; calls.query.push(capture);
    return { accountsPartial(accounts) { capture.accounts = accounts; return this; }, remainingAccounts(accounts) { capture.remaining = accounts; return this; },
      async instruction() { return { hostMockQueryInstruction: true, capture }; } };
  } } };
  const transport = { async stage(...args) { calls.staged.push(args); return { staged: true }; } };
  const client = new LocalOperationClient({ session: { web3, payer, connection, endpoint: 'http://127.0.0.1:8899' },
    provider: {}, program, ar: { ...arcium, async getMXEPublicKey() { return state.runtimeKey; } }, BN, transport });
  const product = kind === 'merchant' ? le('7') : Buffer.alloc(32, 8);
  const effect = PublicKey.findProgramAddressSync([Buffer.from(kind === 'merchant' ? 'purchase' : 'license'), owner.publicKey.toBuffer(), product], new PublicKey(P[kind]))[0];
  const consumer = kind === 'merchant' ? { sku: '7' } : { productHex32: product.toString('hex'), licenseExpirySlot: '90' };
  const common = { effect: effect.toBuffer(), owner: owner.publicKey.toBuffer(), destination: key(10).toBuffer(), mint: key(11).toBuffer() };
  const contract = kind === 'merchant' ? buildMerchantDigest({ ...common, sku: '7' }) : buildLicenseDigest({ ...common, product, expirySlot: '90' });
  const binding = { sourceDataHex: '01', nativeDataHex: '1b070203', proofAddresses: [key(12), key(13), key(14)].map(k => k.toBase58()), proofDataHex: ['04', '05', '06'] };
  const action = buildActionTemplate({ source: key(9).toBuffer(), mint: common.mint, destination: common.destination, owner: common.owner,
    sourceData: Buffer.from(binding.sourceDataHex, 'hex'), nativeData: Buffer.from(binding.nativeDataHex, 'hex'),
    proofKeys: binding.proofAddresses.map(bytes), proofData: binding.proofDataHex.map(v => Buffer.from(v, 'hex')),
    newSource: Buffer.alloc(64, 15), commitment: Buffer.alloc(32, 16), quota: bytes(P.quota), consumer: bytes(P[kind]), consumerContract: contract });
  state.action = { owner: owner.publicKey, template: Buffer.from(action), nativeData: Buffer.from(binding.nativeDataHex, 'hex') };
  const queued = Buffer.alloc(520); action.copy(queued); quota.subarray(8, 40).copy(queued, 16); le(4n, 16).copy(queued, 464); le(100n).copy(queued, 512);
  const q = { offset: '29', expiry: '100', publicKeyHex: '15'.repeat(32), clientNonceHex: '16'.repeat(16), amountCiphertextHex: '17'.repeat(32), openingCiphertextHex: '18'.repeat(32) };
  const acc = client.accounts(new BN(q.offset));
  const plan = validateOperationPlan({ schema: 1, contextSlot: 1, label: 'host-client', genesisHash: genesis, action: key(5).toBase58(), mxePublicKeyHex: runtimeKey.toString('hex'),
    quotaSnapshotHex: quota.toString('hex'), binding, query: q, descriptor: { profile: P.name, consumerKind: kind, ...consumer,
      owner: owner.publicKey.toBase58(), admin: payer.publicKey.toBase58(), effect: effect.toBase58(), quota: P.quota, permit: key(19).toBase58(),
      job: acc.job.toBase58(), computation: acc.computationAccount.toBase58(), templateHex: queued.toString('hex'), queryStateHashHex: queryStateDigest(quota).toString('hex'),
      inputsHashHex: hash(Buffer.from(q.publicKeyHex, 'hex'), Buffer.from(q.clientNonceHex, 'hex'), Buffer.from(q.amountCiphertextHex, 'hex'),
        Buffer.from(q.openingCiphertextHex, 'hex'), quota.subarray(40, 88), le(4n, 16), queued.subarray(336, 368)).toString('hex') } });
  return { client, plan, owner, payer, calls, state, product, contract, effect };
}

function replaceEffectWithSelfConsistentWrongPda(f) {
  const d = f.plan.descriptor, template = Buffer.from(d.templateHex, 'hex'); d.effect = key(20).toBase58();
  const common = { effect: bytes(d.effect), owner: bytes(d.owner), destination: template.subarray(144, 176), mint: template.subarray(112, 144) };
  const contract = d.consumerKind === 'merchant' ? buildMerchantDigest({ ...common, sku: d.sku })
    : buildLicenseDigest({ ...common, product: Buffer.from(d.productHex32, 'hex'), expirySlot: d.licenseExpirySlot });
  contract.copy(template, 432); d.templateHex = template.toString('hex');
  validateOperationPlan(f.plan); // Digest consistency alone does not establish PDA correctness.
}

test('both consumers reject a self-consistent digest using a noncanonical effect PDA', async () => {
  for (const kind of ['merchant', 'license']) {
    const f = fixture(kind); replaceEffectWithSelfConsistentWrongPda(f);
    assert.throws(() => f.client.commitInstruction(f.plan), /Noncanonical consumer effect/);
    await assert.rejects(f.client.queryInstruction(f.plan), /Noncanonical consumer effect/);
    assert.equal(f.calls.staged.length, 0);
  }
});

test('changed query offset cannot silently select another Job or computation', async () => {
  const f = fixture(); f.plan.query.offset = '30';
  await assert.rejects(f.client.queryInstruction(f.plan), /Query offset identity mismatch/);
  assert.equal(f.calls.query.length, 0);
});

test('imported action owner, reserved header, native bytes and semantic template are verified before staging', async () => {
  for (const mutate of [f => { f.state.action.owner = key(21); }, f => { f.state.action.template[0] = 1; },
    f => { f.state.action.template[432] ^= 1; }, f => { f.state.action.nativeData[2] ^= 1; }]) {
    const f = fixture(); mutate(f);
    await assert.rejects(f.client.stageQuery(f.plan, { owner: f.owner }), /Immutable action differs/);
    assert.equal(f.calls.staged.length, 0); assert.equal(f.calls.fetched.length, 0);
  }
});

test('query rejects wrong owner, changed genesis, changed quota and rotated runtime key before signing', async () => {
  const wrongOwner = fixture();
  await assert.rejects(wrongOwner.client.stageQuery(wrongOwner.plan, { owner: Keypair.fromSeed(Buffer.alloc(32, 22)) }), /Explicit owner/);
  assert.equal(wrongOwner.state.actionFetches, 0);
  for (const [mutate, reason] of [
    [f => { f.state.genesis = key(23).toBase58(); }, /different ledger/],
    [f => { f.state.quota = Buffer.from(f.state.quota); f.state.quota[88]++; }, /Query snapshot changed/],
    [f => { f.state.runtimeKey = Buffer.alloc(32, 24); }, /Runtime key changed/],
  ]) {
    const f = fixture(); mutate(f); await assert.rejects(f.client.stageQuery(f.plan, { owner: f.owner }), reason);
    assert.equal(f.calls.staged.length, 0);
  }
});

test('query ABI carries exact encrypted inputs, digest and eight native validation accounts', async () => {
  const f = fixture(); await f.client.stageQuery(f.plan, { owner: f.owner });
  assert.equal(f.calls.staged.length, 1); assert.equal(f.calls.staged[0][3].role, 'query');
  const { args, accounts, remaining } = f.calls.query[0];
  assert.equal(args.length, 7); assert.equal(args[0].toString(), f.plan.query.offset);
  assert.equal(args[5].toString(), f.plan.query.expiry);
  assert.equal(Buffer.from(args[6]).toString('hex'), f.plan.descriptor.queryStateHashHex);
  assert.equal(accounts.sourceOwner.toBase58(), f.plan.descriptor.owner);
  assert.equal(accounts.permit.toBase58(), f.plan.descriptor.permit);
  assert.equal(remaining.length, 8); assert(remaining.every(meta => !meta.isSigner && !meta.isWritable));
  assert.deepEqual(remaining.slice(3, 6).map(meta => meta.pubkey.toBase58()), f.plan.binding.proofAddresses);
});

test('commit instructions preserve consumer-specific payload and exact seventeen-account privileges', () => {
  for (const kind of ['merchant', 'license']) {
    const f = fixture(kind), ix = f.client.commitInstruction(f.plan);
    assert.equal(ix.programId.toBase58(), P[kind]); assert.equal(ix.keys.length, 17);
    assert.deepEqual(ix.keys.flatMap((meta, i) => meta.isSigner ? [i] : []), [11]);
    assert.deepEqual(ix.keys.flatMap((meta, i) => meta.isWritable ? [i] : []), [0, 1, 5, 7, 16]);
    assert.equal(ix.keys[4].pubkey.toBase58(), TOKEN_PROGRAM); assert.equal(ix.keys[16].pubkey.toBase58(), f.plan.descriptor.effect);
    const prefix = kind === 'merchant' ? Buffer.concat([Buffer.from([1]), le('7'), Buffer.from([0])])
      : Buffer.concat([Buffer.from([2]), f.product, le('90'), Buffer.from([0])]);
    assert(ix.data.equals(Buffer.concat([prefix, Buffer.from(f.plan.binding.nativeDataHex, 'hex')])));
    assert(ix.keys[14].pubkey.equals(PublicKey.findProgramAddressSync([Buffer.from('cyperlink-action'), f.contract], ix.programId)[0]));
  }
});

test('commit staging requires the exact owner and an authorized observation', async () => {
  const wrong = fixture(); wrong.client.observe = async () => { throw Error('must not observe with wrong owner'); };
  await assert.rejects(wrong.client.stageCommit(wrong.plan, { owner: Keypair.fromSeed(Buffer.alloc(32, 25)) }), /Explicit owner/);
  for (const status of ['unobserved', 'queued', 'stale', 'expired', 'denied', 'cancelled', 'invalidated', 'committed']) {
    const f = fixture(); f.client.observe = async () => ({ status });
    await assert.rejects(f.client.stageCommit(f.plan, { owner: f.owner }), new RegExp(`while ${status}`));
    assert.equal(f.calls.staged.length, 0);
  }
  const good = fixture(); good.client.observe = async () => ({ status: 'authorized' });
  await good.client.stageCommit(good.plan, { owner: good.owner });
  assert.equal(good.calls.staged.length, 1); assert.equal(good.calls.staged[0][3].role, 'commit');
});
