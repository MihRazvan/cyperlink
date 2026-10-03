import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, readFile, writeFile, readdir, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { REPO, loadWeb3 } from '../src/runtime.mjs';
import { DurableTransactionSender } from '../src/durable-transaction.mjs';
import { SignedInstructionSender } from '../src/transaction-sender.mjs';

const web3 = await loadWeb3(process.env.CYPERLINK_JS_MODULE_ROOT ?? resolve(REPO, '.local/toolchain/js'));
const endpoint = 'http://127.0.0.1:8899/';
const key = byte => new web3.PublicKey(Buffer.alloc(32, byte));
async function fixture(t, overrides = {}) {
  await mkdir(resolve(REPO, '.local'), { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(resolve(REPO, '.local/durable-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const payer = web3.Keypair.generate(), genesisHash = key(66).toBase58();
  const state = { genesisHash, valid: true, height: 10, sends: [], receipt: null, status: null, latestCalls: 0, ...overrides };
  const latest = { blockhash: key(67).toBase58(), lastValidBlockHeight: 100 };
  const connection = {
    rpcEndpoint: endpoint,
    getGenesisHash: async () => state.genesisHash,
    getTransaction: async () => state.receipt,
    getSignatureStatuses: async () => ({ context: { slot: 20 }, value: [state.status] }),
    isBlockhashValid: async () => ({ context: { slot: 20 }, value: state.valid }),
    getBlockHeight: async () => state.height,
    getLatestBlockhash: async () => { state.latestCalls++; return latest; },
    simulateTransaction: async () => ({ context: { slot: 20 }, value: { err: state.simulationError ?? null, unitsConsumed: 200 } }),
    sendRawTransaction: async (wire, config) => {
      assert.equal(config.maxRetries, state.expectedRpcRetries ?? 5); state.sends.push(Buffer.from(wire));
      if (state.onSend) return state.onSend(wire);
      return state.ticket.signature;
    },
  };
  const instructions = [web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: key(68), lamports: 1 })];
  const transaction = new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: latest.blockhash, instructions }).compileToV0Message()); transaction.sign([payer]);
  const options = { web3, connection, endpoint, directory: resolve(directory, 'journal'), maxBroadcasts: 3 };
  const sender = await DurableTransactionSender.create(options);
  const ticket = await sender.prepare({ label: 'owner-commit', transaction, blockhash: latest, descriptorSha256: 'ab'.repeat(32), role: 'commit' }); state.ticket = ticket;
  function land(err = null, tx = transaction) {
    state.receipt = { slot: 20, meta: { err, fee: 5000, computeUnitsConsumed: 199, loadedAddresses: { writable: [], readonly: [] } }, transaction: { message: tx.message, signatures: [ticket.signature] } };
    return state.receipt;
  }
  return { state, options, sender, ticket, land, transaction, connection, payer, instructions, directory, latest };
}

test('separate process reopens prepared signed journal without wallet or broadcast', async t => {
  const f = await fixture(t);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {loadWeb3} from './packages/local-client/src/runtime.mjs';
    import {DurableTransactionSender} from './packages/local-client/src/durable-transaction.mjs';
    const args=JSON.parse(process.argv[1]);
    const web3=await loadWeb3(args.moduleRoot);
    const connection={rpcEndpoint:args.endpoint,getGenesisHash:async()=>args.ticket.genesisHash,getTransaction:async()=>null,
      getSignatureStatuses:async()=>({context:{slot:20},value:[null]}),isBlockhashValid:async()=>({value:true}),getBlockHeight:async()=>10,
      sendRawTransaction:async()=>{throw Error('Recovery broadcast unexpectedly')}};
    const sender=await DurableTransactionSender.open({web3,connection,endpoint:args.endpoint,directory:args.ticket.journalDirectory});
    const result=await sender.recover(args.ticket);console.log(JSON.stringify({status:result.status,attempts:result.attempts}));
  `, JSON.stringify({ moduleRoot: resolve(REPO, '.local/toolchain/js'), endpoint, ticket: f.ticket })], { cwd: REPO, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr); assert.deepEqual(JSON.parse(child.stdout), { status: 'prepared', attempts: 0 });
  const record = JSON.parse(await readFile(resolve(f.options.directory, `${f.ticket.signature}.signed.json`)));
  assert.equal(record.wireBase64, Buffer.from(f.transaction.serialize()).toString('base64'));
  assert(!JSON.stringify(record).includes(Buffer.from(f.payer.secretKey).toString('base64')));
  assert.equal(f.state.sends.length, 0);
});

test('lost broadcast response reconciles exact landed receipt; reopening never resubmits it', async t => {
  const f = await fixture(t);
  f.state.onSend = () => { f.land(); throw Error('Response lost after acceptance'); };
  const result = await f.sender.send(f.ticket, { pollAttempts: 0 });
  assert.equal(result.status, 'landed'); assert.equal(result.attempts, 1); assert.match(result.lastSendError, /Response lost/);
  const reopened = await DurableTransactionSender.open(f.options);
  assert.equal((await reopened.send(f.ticket, { pollAttempts: 0 })).status, 'landed');
  assert.equal(f.state.sends.length, 1); assert.equal(f.state.latestCalls, 0);
  const recovered = await reopened.recover(f.ticket);
  assert.match(recovered.lastSendError, /Response lost/);
  assert.equal(recovered.broadcasts[0].response.outcome, 'error');
  assert.deepEqual(recovered.retryPolicy, { maxBroadcasts: 3, rpcMaxRetries: 5 });
});

test('restart preserves broadcast budget and only retransmits identical signed bytes', async t => {
  const f = await fixture(t);
  f.state.onSend = () => { throw Error('Connection dropped'); };
  await f.sender.send(f.ticket, { pollAttempts: 0 });
  const reopened = await DurableTransactionSender.open(f.options);
  const result = await reopened.send(f.ticket, { pollAttempts: 4, pollIntervalMs: 0, retryEvery: 1 });
  assert.equal(result.status, 'pending'); assert.equal(result.attempts, 3); assert.equal(result.canBroadcast, false);
  assert.equal(f.state.sends.length, 3);
  for (const wire of f.state.sends) assert.deepEqual(wire, Buffer.from(f.transaction.serialize()));
  await reopened.send(f.ticket, { pollAttempts: 0 }); assert.equal(f.state.sends.length, 3); assert.equal(f.state.latestCalls, 0);
});

test('landed failed receipt is final transport evidence and never treated as successful payment', async t => {
  const f = await fixture(t); f.state.onSend = () => { f.land({ InstructionError: [0, { Custom: 803 }] }); return f.ticket.signature; };
  assert.equal((await f.sender.send(f.ticket, { pollAttempts: 0 })).status, 'failed');
  const reopened = await DurableTransactionSender.open(f.options);
  assert.equal((await reopened.recover(f.ticket)).receipt.meta.err.InstructionError[1].Custom, 803);
  assert.equal(f.state.sends.length, 1);
});

test('expired unknown and observed-without-receipt never rebuild or resend', async t => {
  const f = await fixture(t); f.state.valid = false;
  assert.equal((await f.sender.send(f.ticket, { pollAttempts: 0 })).status, 'expired-unresolved');
  f.state.valid = true; f.state.height = 101;
  assert.equal((await f.sender.recover(f.ticket)).status, 'expired-unresolved');
  f.state.status = { slot: 20, err: null, confirmationStatus: 'confirmed' };
  assert.equal((await f.sender.send(f.ticket, { pollAttempts: 1, pollIntervalMs: 0 })).status, 'observed-without-receipt');
  assert.equal(f.state.sends.length, 0); assert.equal(f.state.latestCalls, 0);
});

test('different ledger, forged ticket and tampered wire fail closed before network write', async t => {
  const f = await fixture(t);
  f.state.genesisHash = key(69).toBase58(); await assert.rejects(DurableTransactionSender.open(f.options), /genesis/);
  await assert.rejects(f.sender.send(f.ticket, { pollAttempts: 0 }), /genesis/);
  f.state.genesisHash = f.ticket.genesisHash;
  await assert.rejects(f.sender.recover({ ...f.ticket, descriptorSha256: 'cd'.repeat(32) }), /semantic binding/);
  const path = resolve(f.options.directory, `${f.ticket.signature}.signed.json`), record = JSON.parse(await readFile(path));
  record.wireBase64 = Buffer.alloc(100).toString('base64'); await writeFile(path, JSON.stringify(record));
  await assert.rejects(f.sender.recover(f.ticket), /integrity/); assert.equal(f.state.sends.length, 0);
});

test('landed message, signature and lookup resolution must all equal prepared wire', async t => {
  const f = await fixture(t); const receipt = f.land();
  receipt.transaction.signatures = [key(70).toBase58()]; await assert.rejects(f.sender.recover(f.ticket), /signatures differ/);
  receipt.transaction.signatures = [f.ticket.signature]; receipt.meta.loadedAddresses.writable = [key(71)];
  await assert.rejects(f.sender.recover(f.ticket), /lookup resolution differs/);
  receipt.meta.loadedAddresses.writable = [];
  const tx = new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: f.payer.publicKey, recentBlockhash: key(72).toBase58(), instructions: f.instructions }).compileToV0Message());
  receipt.transaction.message = tx.message; await assert.rejects(f.sender.recover(f.ticket), /message differs/);
});

test('journal files refuse symlinks and unsigned bytes; returned RPC signature cannot redirect lookup', async t => {
  const f = await fixture(t);
  const unsigned = new web3.VersionedTransaction(f.transaction.message);
  await assert.rejects(f.sender.prepare({ label: 'unsigned', transaction: unsigned, blockhash: f.latest }), /signature/);
  f.state.onSend = () => 'wrong-signature'; await assert.rejects(f.sender.send(f.ticket, { pollAttempts: 0 }), /different transaction signature/);
  const path = resolve(f.options.directory, `${f.ticket.signature}.signed.json`), target = resolve(f.directory, 'outside.json');
  await writeFile(target, await readFile(path), { mode: 0o600 }); await rm(path); await symlink(target, path);
  await assert.rejects(f.sender.recover(f.ticket));
});

test('instruction staging persists signed wire and simulation; keyless reopen submits exact stage', async t => {
  const f = await fixture(t), recorded = [];
  const sender = new SignedInstructionSender({ web3, connection: f.connection, payer: f.payer, endpoint, directory: f.directory }, result => recorded.push(result));
  const ticket = await sender.stage('explicit-query', f.instructions, [], { role: 'query', descriptorSha256: 'ef'.repeat(32) });
  assert.equal(f.state.sends.length, 0); assert.equal(ticket.role, 'query');
  f.state.onSend = wire => {
    const tx = web3.VersionedTransaction.deserialize(wire);
    f.state.receipt = { slot: 20, meta: { err: null, fee: 5000, computeUnitsConsumed: 199 }, transaction: { message: tx.message, signatures: [ticket.signature] } };
    return ticket.signature;
  };
  const reopened = new SignedInstructionSender({ web3, connection: f.connection, endpoint, directory: f.directory }, result => recorded.push(result));
  const result = await reopened.submit(ticket, { pollAttempts: 0 });
  assert.equal(result.label, 'explicit-query'); assert.equal(result.simulatedCU, 200); assert.equal(result.landedCU, 199); assert.equal(result.error, null); assert.equal(recorded.length, 1);
  assert.equal((await reopened.recover(ticket)).status, 'landed'); assert.equal(f.state.latestCalls, 1);
});

test('failed or interrupted simulation remains unsendable through keyless recovery', async t => {
  const f = await fixture(t); f.state.simulationError = { InstructionError: [0, { Custom: 705 }] };
  const sender = new SignedInstructionSender({ web3, connection: f.connection, payer: f.payer, endpoint, directory: f.directory });
  await assert.rejects(sender.stage('bad-query', f.instructions), /bad-query/);
  const journal = await sender.durable();
  const record = JSON.parse(await readFile(resolve(journal.directory, (await readdir(journal.directory)).find(name => name.endsWith('.signed.json')))));
  const ticket = { schemaVersion: 1, journalDirectory: journal.directory, genesisHash: record.genesisHash, signature: record.signature, wireSha256: record.wireSha256, role: record.role, descriptorSha256: null };
  assert.equal((await journal.send(ticket, { pollAttempts: 0 })).status, 'simulation-rejected');
  await rm(resolve(journal.directory, `${ticket.signature}.simulation.json`));
  assert.equal((await journal.send(ticket, { pollAttempts: 0 })).status, 'simulation-required'); assert.equal(f.state.sends.length, 0);
});

test('real ALT compilation retains exact resolved keys and rejects changed landed resolution', async t => {
  const f = await fixture(t);
  const table = new web3.AddressLookupTableAccount({ key: key(90), state: {
    deactivationSlot: 18446744073709551615n, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0,
    authority: f.payer.publicKey, addresses: [key(68)],
  } });
  const transaction = new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: f.payer.publicKey,
    recentBlockhash: f.latest.blockhash, instructions: f.instructions }).compileToV0Message([table])); transaction.sign([f.payer]);
  assert.equal(transaction.message.addressTableLookups.length, 1);
  const ticket = await f.sender.prepare({ label: 'alt-commit', transaction, blockhash: f.latest, addressLookupTables: [table] });
  f.state.receipt = { slot: 20, meta: { err: null, loadedAddresses: { writable: [key(68)], readonly: [] } }, transaction: { message: transaction.message, signatures: [ticket.signature] } };
  assert.equal((await f.sender.recover(ticket)).status, 'landed');
  f.state.receipt.meta.loadedAddresses.writable = [key(91)];
  await assert.rejects(f.sender.recover(ticket), /lookup resolution differs/);
});

test('RPC retry limit is retained across restart and legacy journals keep zero retries', async t => {
  const f = await fixture(t), path = resolve(f.options.directory, 'journal.json');
  const manifest = JSON.parse(await readFile(path));
  assert.equal(manifest.schemaVersion, 2); assert.equal(manifest.rpcMaxRetries, 5);
  manifest.schemaVersion = 1; delete manifest.rpcMaxRetries;
  await writeFile(path, JSON.stringify(manifest)); f.state.expectedRpcRetries = 0;
  const legacy = await DurableTransactionSender.open(f.options);
  const result = await legacy.send(f.ticket, { pollAttempts: 0 });
  assert.equal(result.retryPolicy.rpcMaxRetries, 0); assert.equal(result.broadcasts[0].rpcMaxRetries, 0);
  assert.equal(result.broadcasts[0].response.outcome, 'accepted');
  assert.equal(result.broadcasts[0].response.returnedSignature, f.ticket.signature);
  assert.equal(result.status, 'pending'); // RPC acceptance is not transaction delivery.
  manifest.schemaVersion = 2; manifest.rpcMaxRetries = 11; await writeFile(path, JSON.stringify(manifest));
  await assert.rejects(DurableTransactionSender.open(f.options), /RPC retry limit/);
});

test('missing response remains unknown after restart; corrupted response cannot change binding', async t => {
  const f = await fixture(t);
  await f.sender.send(f.ticket, { pollAttempts: 0 });
  const responsePath = resolve(f.options.directory, `${f.ticket.signature}.response-1.json`);
  const response = JSON.parse(await readFile(responsePath));
  assert.equal(response.outcome, 'accepted'); assert.equal(typeof response.completedAt, 'string');
  await rm(responsePath); // Crash after send, before publishing its response.
  const reopened = await DurableTransactionSender.open(f.options);
  const unknown = await reopened.recover(f.ticket);
  assert.equal(unknown.attempts, 1); assert.equal(unknown.broadcasts[0].response, null);
  response.signature = 'different'; await writeFile(responsePath, JSON.stringify(response), { mode: 0o600 });
  await assert.rejects(reopened.recover(f.ticket), /response binding mismatch/);
});

test('legacy retained receipts preserve their floor without new cursor files', async t => {
  const f = await fixture(t); f.land(); await f.sender.recover(f.ticket);
  const { readdir, unlink } = await import('node:fs/promises');
  for (const name of await readdir(f.sender.directory)) if (name.includes('.context-')) await unlink(resolve(f.sender.directory, name));
  assert.equal((await f.sender.read(f.ticket)).observationSlot, 20);
  f.state.receipt = null;
  f.connection.getSignatureStatuses = async () => ({ context: { slot: 19 }, value: [null] });
  await assert.rejects(f.sender.recover(f.ticket), /older than retained operation/);
});

test('restored receipt reconciles the original signature after typed transport uncertainty', async t => {
  const { RpcUnavailableError } = await import('../../sdk/src/rpc-availability.mjs');
  const f = await fixture(t), readReceipt = f.connection.getTransaction;
  f.connection.getTransaction = async () => { throw new RpcUnavailableError({ method: 'getTransaction', category: 'http', status: 503 }); };
  const uncertain = await f.sender.recover(f.ticket);
  assert.equal(uncertain.status, 'delivery-unavailable'); assert.equal(uncertain.canBroadcast, false);
  f.land(); f.connection.getTransaction = readReceipt;
  const restored = await f.sender.recover(f.ticket);
  assert.equal(restored.status, 'landed'); assert.equal(restored.signature, uncertain.signature);
  assert.equal(restored.record.wireSha256, uncertain.record.wireSha256); assert.equal(f.state.sends.length, 0);
});
