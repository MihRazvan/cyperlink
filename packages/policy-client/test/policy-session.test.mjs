import { RpcUnavailableError } from '../../sdk/src/rpc-availability.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { mkdtemp, rm, readFile, unlink, readdir } from 'node:fs/promises';
import { loadWeb3, REPO, saveSigner } from '../../local-client/src/runtime.mjs';
import { DurableTransactionSender } from '../../local-client/src/durable-transaction.mjs';
import { PolicySession } from '../src/policy-session.mjs';
import { PolicyOperationClient } from '../src/operation-client.mjs';
import { openApprovalStore } from '../src/approval-store.mjs';
import { descriptorDigest, queryStateDigest, le, validateOperationPlan } from '../src/operation-plan.mjs';
import { instructionJSON } from '../src/operation-ticket.mjs';
import { buildActionTemplate, buildMerchantDigest, publicKeyBytes, validateOperation } from '../src/sdk.mjs';
import { plan as fixturePlan } from './fixture.mjs';

const moduleRoot = process.env.CYPERLINK_JS_MODULE_ROOT ?? resolve(REPO, '.local/toolchain/js');
const web3 = await loadWeb3(moduleRoot), endpoint = 'http://127.0.0.1:8899/';
const key = byte => new web3.PublicKey(Buffer.alloc(32, byte));

// Host-only account bytes and locally signed messages. No validator or proof claim.
async function setup(t) {
  const directory = await mkdtemp(resolve(REPO, '.local/policy-session-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const plan = fixturePlan(), owner = web3.Keypair.generate(), administrator = web3.Keypair.generate();
  const d = plan.descriptor, old = validateOperation(d).template, quota = Buffer.from(plan.quotaSnapshotHex, 'hex');
  d.owner = owner.publicKey.toBase58(); d.admin = administrator.publicKey.toBase58();
  administrator.publicKey.toBuffer().copy(quota, 96);
  plan.quotaSnapshotHex = quota.toString('hex'); d.queryStateHashHex = queryStateDigest(quota).toString('hex');
  d.effect = web3.PublicKey.findProgramAddressSync([Buffer.from('purchase'), owner.publicKey.toBuffer(), le(d.sku)], new web3.PublicKey(d.deployment.programs.merchant))[0].toBase58();
  const digest = buildMerchantDigest({ effect: publicKeyBytes(d.effect), sku: d.sku, owner: owner.publicKey.toBuffer(),
    destination: publicKeyBytes(old.destination), mint: publicKeyBytes(old.mint) });
  const native = buildActionTemplate({ source: publicKeyBytes(old.source), mint: publicKeyBytes(old.mint), destination: publicKeyBytes(old.destination),
    owner: owner.publicKey.toBuffer(), sourceData: Buffer.from(plan.binding.sourceDataHex, 'hex'), nativeData: Buffer.from(plan.binding.nativeDataHex, 'hex'),
    proofKeys: plan.binding.proofAddresses.map(publicKeyBytes), proofData: plan.binding.proofDataHex.map(value => Buffer.from(value, 'hex')),
    newSource: old.newSourceCiphertext, commitment: old.amountCommitment, quota: publicKeyBytes(d.quota), consumer: publicKeyBytes(old.consumer), consumerContract: digest });
  const template = Buffer.from(d.templateHex, 'hex'); native.subarray(80).copy(template, 80); d.templateHex = template.toString('hex');
  const client = new PolicyOperationClient({ deployment: d.deployment, session: { web3, endpoint, payer: administrator }, program: { programId: new web3.PublicKey(d.deployment.programs.auth) } });
  const instruction = client.commitInstruction(plan); plan.instructions = { commit: instructionJSON(instruction) }; validateOperationPlan(plan);
  const table = new web3.AddressLookupTableAccount({ key: key(90), state: { deactivationSlot: 0xffffffffffffffffn,
    lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: administrator.publicKey, addresses: instruction.keys.map(meta => meta.pubkey) } });
  const calls = { simulation: 0, send: 0, signingClient: 0 }, blockhash = { blockhash: key(33).toBase58(), lastValidBlockHeight: 100 };
  let receipt = null;
  const connection = { rpcEndpoint: endpoint, getGenesisHash: async () => plan.genesisHash,
    getAddressLookupTable: async () => ({ context: { slot: 2 }, value: table }), getTransaction: async () => receipt,
    getSignatureStatuses: async () => ({ context: { slot: 2 }, value: [null] }), isBlockhashValid: async () => ({ value: true }), getBlockHeight: async () => 2,
    simulateTransaction: async () => { calls.simulation++; return { context: { slot: 2 }, value: { err: null, unitsConsumed: 50 } }; },
    sendRawTransaction: async () => { calls.send++; throw Error('Unexpected host broadcast'); } };
  const storeOptions = { directory: resolve(directory, 'approvals'), genesisHash: plan.genesisHash, endpoint, deploymentHash: descriptorDigest(d.deployment) };
  const store = await openApprovalStore(storeOptions);
  const fresh = async () => {
    const session = new PolicySession({ deployment: d.deployment, moduleRoot, endpoint, directory: storeOptions.directory, web3, connection, store: await openApprovalStore(storeOptions) });
    session.reader.observe = async () => ({ status: 'authorized', slot: 2 });
    return session;
  };
  const signers = { ownerKeyfile: resolve(directory, 'owner.json'), administratorKeyfile: resolve(directory, 'administrator.json') };
  await saveSigner(signers.ownerKeyfile, owner); await saveSigner(signers.administratorKeyfile, administrator);
  async function publish(journalDirectory) {
    const journal = await DurableTransactionSender.create({ web3, connection, endpoint, directory: journalDirectory });
    const transaction = new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: administrator.publicKey, recentBlockhash: blockhash.blockhash,
      instructions: [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1300000 }), instruction] }).compileToV0Message([table]));
    transaction.sign([administrator, owner]);
    const ticket = await journal.prepare({ label: 'host-commit', transaction, blockhash, addressLookupTables: [table],
      role: 'commit', descriptorSha256: descriptorDigest(d), minContextSlot: 1, requireSimulation: true });
    return { ticket, journal, transaction };
  }
  return { directory, plan, connection, calls, store, storeOptions, fresh, signers, publish, setReceipt: value => { receipt = value; } };
}

test('connect and observe require no keys; signing requires both explicit matching roles', async t => {
  const f = await setup(t);
  t.mock.method(web3.Connection.prototype, 'getVersion', async () => ({ 'solana-core': '4.3.0' }));
  t.mock.method(web3.Connection.prototype, 'getGenesisHash', async () => f.plan.genesisHash);
  const session = await PolicySession.connect({ deployment: f.plan.descriptor.deployment, endpoint, moduleRoot, directory: f.storeOptions.directory });
  session.reader.observe = async () => ({ status: 'authorized', slot: 2 });
  assert.equal((await session.observe(f.plan)).status, 'authorized');
  for (const signers of [undefined, {}, { ownerKeyfile: f.signers.ownerKeyfile }, { administratorKeyfile: f.signers.administratorKeyfile }]) {
    await assert.rejects(session.stageCommit(f.plan, signers), /Explicit ownerKeyfile and administratorKeyfile/);
    await assert.rejects(session.stageQuery(f.plan, signers), /Explicit ownerKeyfile and administratorKeyfile/);
  }
  await assert.rejects(session.stageCommit(f.plan, { ownerKeyfile: f.signers.administratorKeyfile, administratorKeyfile: f.signers.ownerKeyfile }), /differs from retained operation/);
  assert.deepEqual(await readdir(f.storeOptions.directory), ['approval-store.json']);
});

test('staging reserves one durable intent before its only signing attempt, then returns the original ticket', async t => {
  const f = await setup(t), session = await f.fresh();
  session.signingClient = async directory => {
    f.calls.signingClient++;
    const intent = await f.store.begin(f.plan, 'commit');
    assert.equal(intent.created, false);
    assert.equal(directory, intent.signingDirectory);
    assert.equal(JSON.parse(await readFile(resolve(intent.directory, 'intent.json'))).role, 'commit');
    return { stageCommit: async () => (await f.publish(intent.journalDirectory)).ticket };
  };
  const ticket = await session.stageCommit(f.plan, f.signers);
  assert.deepEqual(await session.stageCommit(f.plan, f.signers), ticket);
  assert.equal(f.calls.signingClient, 1); assert.equal(f.calls.send, 0); assert.equal(f.calls.simulation, 0);
});

test('concurrent facade approvals cannot create a second signing client or replacement signature', async t => {
  const f = await setup(t), sessions = await Promise.all(Array.from({ length: 8 }, () => f.fresh()));
  for (const session of sessions) session.signingClient = async directory => {
    f.calls.signingClient++;
    return { stageCommit: async () => (await f.publish(resolve(directory, 'transaction-journal'))).ticket };
  };
  const outcomes = await Promise.allSettled(sessions.map(session => session.stageCommit(f.plan, f.signers)));
  assert.equal(f.calls.signingClient, 1);
  const ticket = outcomes.find(result => result.status === 'fulfilled').value;
  for (const result of outcomes) {
    if (result.status === 'fulfilled') assert.deepEqual(result.value, ticket);
    else assert.equal(result.reason.code, 'APPROVAL_INTERRUPTED_BEFORE_SIGNED_RECORD');
  }
  assert.deepEqual(await (await f.fresh()).discoverApproval(f.plan, 'commit'), ticket);
});

test('an interrupted signing attempt cannot be restaged, including from a new session', async t => {
  const f = await setup(t), session = await f.fresh();
  session.signingClient = async () => { f.calls.signingClient++; throw Error('Injected interruption before signing'); };
  await assert.rejects(session.stageCommit(f.plan, f.signers), /Injected interruption/);
  const restarted = await f.fresh();
  restarted.signingClient = async () => { throw Error('Restaging must not occur'); };
  await assert.rejects(restarted.stageCommit(f.plan, f.signers), { code: 'APPROVAL_INTERRUPTED_BEFORE_SIGNED_RECORD' });
  await assert.rejects(restarted.recover(f.plan, 'commit'), { code: 'APPROVAL_INTERRUPTED_BEFORE_SIGNED_RECORD' });
  assert.equal(f.calls.signingClient, 1);
});

test('a fresh keyless session recovers a dropped application ticket and leaves missing simulation explicit', async t => {
  const f = await setup(t), reserved = await f.store.begin(f.plan, 'commit'), signed = await f.publish(reserved.journalDirectory);
  await unlink(f.signers.ownerKeyfile); await unlink(f.signers.administratorKeyfile);
  const session = await f.fresh();
  session.signers = session.signingClient = async () => { throw Error('Keyless recovery must not request signing'); };
  const outcome = await session.recover(f.plan, 'commit');
  assert.deepEqual(outcome.ticket, signed.ticket);
  assert.equal(outcome.delivery.status, 'simulation-required');
  assert.equal(outcome.observation.status, 'authorized');
  assert.equal(f.calls.simulation, 0); assert.equal(f.calls.send, 0);
  assert.equal(JSON.stringify(outcome).includes('wireBase64'), false);
  assert.equal(JSON.stringify(outcome).includes('secretKey'), false);
});

test('only explicit submit resumes simulation and broadcasts exactly the original signed bytes', async t => {
  const f = await setup(t), reserved = await f.store.begin(f.plan, 'commit'), signed = await f.publish(reserved.journalDirectory);
  const saved = await signed.journal.read(signed.ticket);
  const session = await f.fresh();
  session.signers = session.signingClient = async () => { throw Error('Submit must not request fresh signing'); };
  f.connection.simulateTransaction = async (transaction, options) => {
    f.calls.simulation++; assert.deepEqual(Buffer.from(transaction.serialize()), saved.wire); assert.equal(options.sigVerify, true);
    return { context: { slot: 2 }, value: { err: null, unitsConsumed: 50 } };
  };
  f.connection.sendRawTransaction = async wire => {
    f.calls.send++; assert.deepEqual(wire, saved.wire);
    f.setReceipt({ slot: 2, meta: { err: null, loadedAddresses: { writable: saved.record.loadedAddresses.writable.map(address => new web3.PublicKey(address)), readonly: saved.record.loadedAddresses.readonly.map(address => new web3.PublicKey(address)) }, fee: 5000, computeUnitsConsumed: 50 },
      transaction: { message: signed.transaction.message, signatures: saved.signatures } });
    return signed.ticket.signature;
  };
  const outcome = await session.submit(f.plan, 'commit');
  assert.equal(outcome.delivery.status, 'landed'); assert.equal(outcome.delivery.signature, signed.ticket.signature);
  assert.equal(f.calls.simulation, 1); assert.equal(f.calls.send, 1);
  const restarted = await f.fresh();
  assert.equal((await restarted.recover(f.plan, 'commit')).delivery.status, 'landed');
  assert.equal(f.calls.simulation, 1); assert.equal(f.calls.send, 1);
});

test('simulation rejection prevents broadcast and remains explicit on subsequent recovery', async t => {
  const f = await setup(t), reserved = await f.store.begin(f.plan, 'commit'); await f.publish(reserved.journalDirectory);
  f.connection.simulateTransaction = async () => { f.calls.simulation++; return { context: { slot: 2 }, value: { err: { InstructionError: [1, { Custom: 803 }] } } }; };
  const session = await f.fresh();
  assert.equal((await session.submit(f.plan, 'commit')).delivery.status, 'simulation-rejected');
  assert.equal((await (await f.fresh()).recover(f.plan, 'commit')).delivery.status, 'simulation-rejected');
  assert.equal(f.calls.simulation, 1); assert.equal(f.calls.send, 0);
});

const unavailable = method => new RpcUnavailableError({ method, category: 'http', status: 503 });

test('receipt/status outages reach account observation, never simulate or send even on explicit submit', async t => {
  const f = await setup(t), reserved = await f.store.begin(f.plan, 'commit'), signed = await f.publish(reserved.journalDirectory);
  f.connection.getTransaction = async () => { throw unavailable('getTransaction'); };
  for (const status of [null, { slot: 2, err: null }]) {
    f.connection.getSignatureStatuses = async () => ({ context: { slot: 8 }, value: [status] });
    const session = await f.fresh();
    session.reader.observe = async () => { assert.equal(session.reader.minimumSlot, 8); return { status: 'committed', slot: 8 }; };
    const result = await session.submit(f.plan, 'commit');
    assert.equal(result.delivery.status, status ? 'observed-without-receipt' : 'delivery-unavailable');
    assert.equal(result.delivery.canBroadcast, false); assert.equal(result.delivery.receipt, undefined);
    assert.equal(result.observation.status, 'committed'); assert.equal(result.ticket.signature, signed.ticket.signature);
  }
  f.connection.getSignatureStatuses = async () => { throw unavailable('getSignatureStatuses'); };
  const session = await f.fresh();
  session.reader.observe = async () => { assert.equal(session.reader.minimumSlot, 8); throw unavailable('getMultipleAccounts'); };
  const result = await session.recover(f.plan, 'commit');
  assert.equal(result.observation.status, 'unresolved'); assert.equal(result.observation.minContextSlot, 8);
  assert.equal(result.delivery.availability.length, 2);
  assert.equal(f.calls.simulation, 0); assert.equal(f.calls.send, 0);
});

test('status-only and later account context survive reopening; older evidence fails closed', async t => {
  const f = await setup(t), reserved = await f.store.begin(f.plan, 'commit'), signed = await f.publish(reserved.journalDirectory);
  f.connection.getSignatureStatuses = async () => ({ context: { slot: 7 }, value: [{ slot: 2, err: null }] });
  const session = await f.fresh();
  session.reader.observe = async () => { assert.equal(session.reader.minimumSlot, 7); return { status: 'authorized', slot: 9 }; };
  const first = await session.recover(f.plan, 'commit');
  assert.equal(first.delivery.status, 'observed-without-receipt'); assert.equal(first.observation.status, 'authorized');
  assert.equal((await signed.journal.read(signed.ticket)).observationSlot, 9);
  await assert.rejects((await f.fresh()).recover(f.plan, 'commit'), /older than retained operation/);
  f.connection.getSignatureStatuses = async () => ({ context: { slot: 9 }, value: [null] });
  const restarted = await f.fresh();
  restarted.reader.observe = async () => ({ status: 'committed', slot: 8 });
  await assert.rejects(restarted.recover(f.plan, 'commit'), /context regressed/);
});

test('availability does not swallow malformed RPC, wrong-method errors or conflicting account evidence', async t => {
  const f = await setup(t), reserved = await f.store.begin(f.plan, 'commit'); await f.publish(reserved.journalDirectory);
  const session = await f.fresh(); let observations = 0;
  session.reader.observe = async () => { observations++; throw Error('Partial/conflicting effects'); };
  for (const error of [new SyntaxError('Malformed receipt JSON'), Error('Invalid receipt'), unavailable('getGenesisHash')]) {
    f.connection.getTransaction = async () => { throw error; };
    await assert.rejects(session.recover(f.plan, 'commit'), error);
  }
  f.connection.getTransaction = async () => undefined;
  await assert.rejects(session.recover(f.plan, 'commit'), /Malformed receipt/);
  f.connection.getTransaction = async () => { throw unavailable('getTransaction'); };
  for (const value of [undefined, {}, { context: { slot: 2 }, value: [] }, { context: { slot: 2 }, value: [{}] }]) {
    f.connection.getSignatureStatuses = async () => value;
    await assert.rejects(session.recover(f.plan, 'commit'));
  }
  assert.equal(observations, 0);
  f.connection.getSignatureStatuses = async () => ({ context: { slot: 2 }, value: [null] });
  await assert.rejects(session.recover(f.plan, 'commit'), /Partial\/conflicting effects/);
  assert.equal(observations, 1); assert.equal(f.calls.send, 0);
});

test('one-shot receipt outage ends explicit submit without a second delivery attempt', async t => {
  const f = await setup(t), reserved = await f.store.begin(f.plan, 'commit'); await f.publish(reserved.journalDirectory);
  let receipts = 0;
  f.connection.getTransaction = async () => { if (++receipts === 1) throw unavailable('getTransaction'); return null; };
  const result = await (await f.fresh()).submit(f.plan, 'commit');
  assert.equal(result.delivery.status, 'delivery-unavailable'); assert.equal(receipts, 1);
  assert.equal(f.calls.simulation, 0); assert.equal(f.calls.send, 0);
});
