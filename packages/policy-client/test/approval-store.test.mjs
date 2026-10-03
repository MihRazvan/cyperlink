import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { mkdtemp, rm, readFile, writeFile, symlink, chmod, unlink } from 'node:fs/promises';
import { loadWeb3, REPO, TOKEN_PROGRAM } from '../../local-client/src/runtime.mjs';
import { DurableTransactionSender } from '../../local-client/src/durable-transaction.mjs';
import { descriptorDigest, queryStateDigest, hash, le } from '../src/operation-plan.mjs';
import { instructionJSON } from '../src/operation-ticket.mjs';
import { openApprovalStore } from '../src/approval-store.mjs';
import { PolicyOperationClient } from '../src/operation-client.mjs';
import { buildActionTemplate, buildMerchantDigest, publicKeyBytes } from '../../sdk/src/index.mjs';
const web3 = await loadWeb3(process.env.CYPERLINK_JS_MODULE_ROOT ?? resolve(REPO, '.local/toolchain/js'));
const require = createRequire(resolve(REPO, '.local/toolchain/js/package.json'));
const anchor = require('@anchor-lang/core'), ar = require('@arcium-hq/client'), BN = require('bn.js');
const key = byte => new web3.PublicKey(Buffer.alloc(32, byte));
import {canonicalHash,policyDomainHash} from '../src/deployment.mjs';
import {stateHash,decodeQuota} from '../src/codec.mjs';
const deployment={schema:1,profile:'local-custom-policy-v1',cipher:'cspl-rescue-scalar253-v1',releaseHashHex:'aa'.repeat(32),schemaHashHex:'00'.repeat(32),domainHashHex:'cc'.repeat(32),mxePublicKeyHex:'01'.repeat(32),genesisHash:key(30).toBase58(),quota:key(71).toBase58(),stateFields:[{name:'remaining',type:'u64'}],programs:Object.fromEntries(['auth','policy','guard','kernel','merchant','license','proofBuffer'].map((name,i)=>[name,key(80+i).toBase58()]))};
deployment.programs.kernel=deployment.programs.guard;
deployment.schemaHashHex=canonicalHash({profile:deployment.profile,cipher:deployment.cipher,stateFields:deployment.stateFields,slots:4});
deployment.domainHashHex=policyDomainHash(deployment);
const P={...deployment.programs,name:deployment.profile,quota:deployment.quota};
// Synthetic host intent and signed transactions only: no native proof or validator claim.
function fixture({ lookup = false } = {}) {
  const admin = web3.Keypair.generate(), owner = web3.Keypair.generate(), source = key(13), mint = key(14), destination = key(15), effect = web3.PublicKey.findProgramAddressSync([Buffer.from('purchase'), owner.publicKey.toBuffer(), le(42n)], new web3.PublicKey(P.merchant))[0];
  const proofKeys = [key(17), key(18), key(19)], nativeData = Buffer.from([27, 7, 1]), sourceData = Buffer.from([1, 2]), proofData = [Buffer.from([3]), Buffer.from([4]), Buffer.from([5])];
  const quota = Buffer.alloc(353); quota[128] = 1; admin.publicKey.toBuffer().copy(quota, 96); quota[56] = 9; Buffer.from(deployment.releaseHashHex+deployment.schemaHashHex+deployment.domainHashHex,'hex').copy(quota,257);stateHash(0n,Buffer.concat([quota.subarray(56,88),quota.subarray(161,257)]),quota.subarray(257,289),quota.subarray(289,321),quota.subarray(321,353)).copy(quota,8);
  const digest = buildMerchantDigest({ effect: effect.toBuffer(), sku: '42', owner: owner.publicKey.toBuffer(), destination: destination.toBuffer(), mint: mint.toBuffer() });
  const template = Buffer.alloc(712);
  buildActionTemplate({ source: source.toBuffer(), mint: mint.toBuffer(), destination: destination.toBuffer(), owner: owner.publicKey.toBuffer(), sourceData, nativeData,
    proofKeys: proofKeys.map(k => k.toBuffer()), proofData, newSource: Buffer.alloc(64, 1), commitment: Buffer.alloc(32, 2), quota: publicKeyBytes(P.quota), consumer: publicKeyBytes(P.merchant), consumerContract: digest }).copy(template);
  quota.subarray(8, 40).copy(template, 16); le(1n, 16).copy(template, 464); le(100n).copy(template, 512);quota.subarray(257,353).copy(template,616);
  const query = { offset: '2', expiry: '100', publicKeyHex: Buffer.alloc(32, 21).toString('hex'), clientNonceHex: Buffer.alloc(16, 22).toString('hex'), amountCiphertextHex: Buffer.alloc(32, 23).toString('hex'), openingCiphertextHex: Buffer.alloc(32, 24).toString('hex') };
  const inputsHash = hash(Buffer.from(query.publicKeyHex, 'hex'), Buffer.from(query.clientNonceHex, 'hex'), Buffer.from(query.amountCiphertextHex, 'hex'), Buffer.from(query.openingCiphertextHex, 'hex'), quota.subarray(40,56),decodeQuota(quota).ciphertexts,le(1n,16),Buffer.alloc(32,2),quota.subarray(257,353));
  const descriptor = { deployment:structuredClone(deployment),profile: P.name, consumerKind: 'merchant', job: key(25).toBase58(), computation: key(26).toBase58(), permit: key(27).toBase58(), owner: owner.publicKey.toBase58(), admin: admin.publicKey.toBase58(), quota: P.quota, effect: effect.toBase58(), sku: '42', templateHex: template.toString('hex'), queryStateHashHex: queryStateDigest(quota).toString('hex'), inputsHashHex: inputsHash.toString('hex') };
  const plan = { mxePublicKeyHex: '01'.repeat(32), schema: 1, contextSlot: 1, label: 'host', genesisHash: key(30).toBase58(), action: key(31).toBase58(), descriptor, query, quotaSnapshotHex: quota.toString('hex'), binding: { nativeDataHex: nativeData.toString('hex'), sourceDataHex: sourceData.toString('hex'), proofAddresses: proofKeys.map(k => k.toBase58()), proofDataHex: proofData.map(p => p.toString('hex')) } };
  const H = new web3.PublicKey(P.policy), G = new web3.PublicKey(P.guard), consumer = new web3.PublicKey(P.merchant);
  const pda = (seeds, program) => web3.PublicKey.findProgramAddressSync(seeds, program)[0];
  const addresses = [new web3.PublicKey(descriptor.permit), new web3.PublicKey(P.quota), pda([Buffer.from('guard')], G), H, new web3.PublicKey(TOKEN_PROGRAM), source, mint, destination,
    ...proofKeys, owner.publicKey, pda([Buffer.from('extra-account-metas'), mint.toBuffer()], H), consumer, pda([Buffer.from('cyperlink-action'), digest], consumer), G, effect];
  const instruction = new web3.TransactionInstruction({ programId: consumer, data: Buffer.concat([Buffer.from([1]), le(42n), Buffer.from([0]), nativeData]),
    keys: addresses.map((pubkey, i) => ({ pubkey, isSigner: i === 11, isWritable: [0, 1, 5, 7, 16].includes(i) })) });
  plan.instructions = { commit: instructionJSON(instruction) };
  const table = new web3.AddressLookupTableAccount({ key: key(32), state: { deactivationSlot: 0xffffffffffffffffn, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, authority: admin.publicKey, addresses: [...addresses] } });
  function recordFor(instructions = [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1300000 }), instruction], payer = admin) {
    const transaction = new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: key(33).toBase58(), instructions }).compileToV0Message(lookup ? [table] : []));
    transaction.sign(payer === owner ? [owner] : [payer, owner]);
    const wire = Buffer.from(transaction.serialize()), loaded = { writable: [], readonly: [] };
    for (const selected of transaction.message.addressTableLookups) {
      for (const [indices, list] of [[selected.writableIndexes, loaded.writable], [selected.readonlyIndexes, loaded.readonly]]) for (const index of indices) list.push(table.state.addresses[index].toBase58());
    }
    return { genesisHash: plan.genesisHash, descriptorSha256: descriptorDigest(descriptor), role: 'commit', wireBase64: wire.toString('base64'), wireSha256: hash(wire).toString('hex'), loadedAddresses: loaded, minContextSlot: 1 };
  }
  const actionData = Buffer.alloc(1200); hash(Buffer.from('account:PreparedAction')).subarray(0, 8).copy(actionData);
  owner.publicKey.toBuffer().copy(actionData, 8); template.subarray(80, 464).copy(actionData, 120);
  actionData.writeUInt32LE(nativeData.length, 504); nativeData.copy(actionData, 508);
  const actionResponse = { context: { slot: 2 }, value: { owner: new web3.PublicKey(P.auth), executable: false, data: actionData } };
  const connection = { getAddressLookupTable: async () => ({ context: { slot: 2 }, value: table }),
    getAccountInfoAndContext: async (address, options) => { assert.equal(address.toBase58(), plan.action); assert(options.minContextSlot >= plan.contextSlot); return actionResponse; } };
  return { plan, instruction, recordFor, connection, table, owner, admin, actionResponse };
}

const endpoint = 'http://127.0.0.1:8899';
async function setup(t) {
  const f = fixture({ lookup: true });
  const directory = await mkdtemp(resolve(REPO, '.local/approval-store-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const options = { directory, genesisHash: f.plan.genesisHash, endpoint, deploymentHash: descriptorDigest(f.plan.descriptor.deployment) };
  const store = await openApprovalStore(options);
  f.connection.rpcEndpoint = endpoint;
  f.connection.getGenesisHash = async () => f.plan.genesisHash;
  return { ...f, directory, options, store };
}
async function signed(f, { blockhash = key(33).toBase58(), role = 'commit', descriptorSha256 = descriptorDigest(f.plan.descriptor) } = {}) {
  const slot = await f.store.begin(f.plan, 'commit');
  const opts = { web3, connection: f.connection, endpoint, directory: slot.journalDirectory };
  let journal;
  try { journal = await DurableTransactionSender.open(opts); }
  catch (error) { if (error.code !== 'ENOENT') throw error; journal = await DurableTransactionSender.create(opts); }
  const transaction = new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: f.admin.publicKey, recentBlockhash: blockhash,
    instructions: [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1300000 }), f.instruction] }).compileToV0Message([f.table]));
  transaction.sign([f.admin, f.owner]);
  const ticket = await journal.prepare({ label: 'host-approval', transaction, blockhash: { blockhash, lastValidBlockHeight: 100 },
    addressLookupTables: [f.table], role, descriptorSha256, minContextSlot: 1, requireSimulation: true });
  return { ticket, journal, slot };
}
const discover = f => f.store.discover(f.plan, 'commit', { web3, connection: f.connection });

test('concurrent approval reservation has exactly one winner and stable paths across reopening', async t => {
  const f = await setup(t);
  const stores = await Promise.all(Array.from({ length: 12 }, () => openApprovalStore(f.options)));
  const attempts = await Promise.all(stores.map(store => store.begin(f.plan, 'commit')));
  assert.equal(attempts.filter(item => item.created).length, 1);
  for (const item of attempts) assert.deepEqual(item.intent, attempts[0].intent);
  assert.equal((await f.store.begin(f.plan, 'query')).created, true);
  assert.equal((await f.store.begin(f.plan, 'commit')).created, false);
  assert.equal((await readFile(resolve(attempts[0].directory, 'intent.json'), 'utf8')).includes('secret'), false);
  await assert.rejects(discover(f), { code: 'APPROVAL_INTERRUPTED_BEFORE_SIGNED_RECORD' });
  assert.equal((await f.store.begin(f.plan, 'commit')).created, false);
});

test('lost application ticket is rediscovered from signed bytes without simulation or signer access', async t => {
  const f = await setup(t), { ticket, journal } = await signed(f);
  f.store = await openApprovalStore(f.options);
  const restored = await discover(f);
  assert.deepEqual(restored, ticket);
  assert.deepEqual(JSON.parse(await readFile(f.store.ticketPath(f.plan, 'commit'))), ticket);
  assert.equal((await journal.read(restored)).simulation, undefined);
  f.connection.getTransaction = async () => null;
  f.connection.getSignatureStatuses = async () => ({ context: { slot: 2 }, value: [null] });
  f.connection.isBlockhashValid = async () => ({ value: true });
  f.connection.getBlockHeight = async () => 2;
  assert.equal((await journal.recover(restored)).status, 'simulation-required');
  await unlink(f.store.ticketPath(f.plan, 'commit'));
  assert.deepEqual(await discover(f), ticket);
});

test('query discovery verifies the signed owner/admin instruction and immutable PreparedAction', async t => {
  const f = await setup(t);
  const provider = new anchor.AnchorProvider(new web3.Connection(endpoint), new anchor.Wallet(f.admin), { commitment: 'confirmed' });
  const idl = JSON.parse(await readFile(resolve(REPO, 'programs/auth/target/idl/cyperlink_auth.json')));
  idl.address = P.auth;
  const ix = idl.instructions.find(ix => ix.name === 'runtime_budget_bound');
  ix.name = 'runtime_policy_evaluate'; ix.discriminator = [...hash(Buffer.from('global:runtime_policy_evaluate')).subarray(0, 8)];
  ix.accounts.find(account => account.name === 'quota').address = P.quota;
  ix.accounts.find(account => account.name === 'policy_program').address = P.policy;
  const program = new anchor.Program(idl, provider);
  const client = new PolicyOperationClient({ deployment: f.plan.descriptor.deployment, session: { web3, endpoint, payer: f.admin }, provider, program, ar, BN });
  const accounts = client.accounts(new BN(f.plan.query.offset));
  f.plan.descriptor.job = accounts.job.toBase58(); f.plan.descriptor.computation = accounts.computationAccount.toBase58();
  const instruction = await client.queryInstruction(f.plan);
  f.plan.instructions.query = instructionJSON(instruction); f.table.state.addresses = instruction.keys.map(meta => meta.pubkey);
  const slot = await f.store.begin(f.plan, 'query');
  const journal = await DurableTransactionSender.create({ web3, connection: f.connection, endpoint, directory: slot.journalDirectory });
  const transaction = new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: f.admin.publicKey, recentBlockhash: key(33).toBase58(),
    instructions: [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1300000 }), instruction] }).compileToV0Message([f.table]));
  transaction.sign([f.admin, f.owner]);
  const ticket = await journal.prepare({ label: 'host-query', transaction, blockhash: { blockhash: key(33).toBase58(), lastValidBlockHeight: 100 },
    addressLookupTables: [f.table], role: 'query', descriptorSha256: descriptorDigest(f.plan.descriptor), minContextSlot: 1, requireSimulation: true });
  const recovered = await f.store.discover(f.plan, 'query', { web3, connection: f.connection });
  assert.deepEqual(recovered, ticket);
  f.actionResponse.value.data[120] ^= 1;
  await assert.rejects(f.store.discover(f.plan, 'query', { web3, connection: f.connection }), /Immutable action template differs/);
});

test('ticket publication is create-only, idempotent, and refuses metadata and path substitution', async t => {
  const f = await setup(t), { ticket } = await signed(f);
  const values = await Promise.all(Array.from({ length: 12 }, () => f.store.saveTicket(f.plan, 'commit', { ...ticket, simulatedCU: 42 })));
  values.forEach(value => assert.deepEqual(value, ticket));
  for (const change of [{ role: 'query' }, { descriptorSha256: '00'.repeat(32) }, { genesisHash: key(90).toBase58() },
    { journalDirectory: resolve(f.directory, 'other') }, { journalDirectory: ticket.journalDirectory + '/.' }]) {
    await assert.rejects(f.store.saveTicket(f.plan, 'commit', { ...ticket, ...change }), /differs from intent/);
  }
  await assert.rejects(f.store.saveTicket(f.plan, 'commit', { ...ticket, wireSha256: '00'.repeat(32) }), /different signed transaction/);
  assert.deepEqual(await discover(f), ticket);
});

test('two valid signed candidates remain ambiguous even with an already saved application ticket', async t => {
  const f = await setup(t), first = await signed(f);
  await f.store.saveTicket(f.plan, 'commit', first.ticket);
  await signed(f, { blockhash: key(34).toBase58() });
  await assert.rejects(discover(f), { code: 'APPROVAL_AMBIGUOUS' });
});

test('mismatched operation role or descriptor in the bound journal fails closed', async t => {
  for (const options of [{ role: 'query' }, { descriptorSha256: '00'.repeat(32) }]) {
    const f = await setup(t); await signed(f, options);
    await assert.rejects(discover(f), /differs from intent/);
  }
});

test('generic ALT records are ignored and cannot count as a signed operation', async t => {
  const f = await setup(t), { ticket, journal } = await signed(f);
  const recordPath = resolve(journal.directory, `${ticket.signature}.signed.json`);
  await unlink(recordPath);
  const [create] = web3.AddressLookupTableProgram.createLookupTable({ authority: f.admin.publicKey, payer: f.admin.publicKey, recentSlot: 1 });
  const blockhash = { blockhash: key(33).toBase58(), lastValidBlockHeight: 100 };
  const transaction = new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: f.admin.publicKey, recentBlockhash: blockhash.blockhash,
    instructions: [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1300000 }), create] }).compileToV0Message());
  transaction.sign([f.admin]);
  await journal.prepare({ label: 'create-demo-alt', category: 'lookup-table', role: 'create-demo-alt', transaction, blockhash });
  await assert.rejects(discover(f), { code: 'APPROVAL_INTERRUPTED_BEFORE_SIGNED_RECORD' });
  const second = await signed(f, { blockhash: key(34).toBase58() });
  assert.deepEqual(await discover(f), second.ticket);
});

test('operation records cannot be hidden by relabeling them as generic ALT setup', async t => {
  const f = await setup(t), { ticket, journal } = await signed(f);
  const path = resolve(journal.directory, `${ticket.signature}.signed.json`), record = JSON.parse(await readFile(path));
  delete record.descriptorSha256; record.role = 'create-demo-alt'; record.category = 'lookup-table';
  await writeFile(path, JSON.stringify(record));
  await signed(f, { blockhash: key(34).toBase58() });
  await assert.rejects(discover(f), /ALT setup/);
});

test('wire corruption, invalid signatures, stale ALT resolution and journal genesis are never adopted', async t => {
  for (const mode of ['wire', 'signature', 'alt', 'genesis', 'json']) {
    const f = await setup(t), { ticket, journal } = await signed(f);
    const path = resolve(journal.directory, `${ticket.signature}.signed.json`), record = JSON.parse(await readFile(path));
    if (mode === 'wire') record.wireBase64 = 'AA==';
    if (mode === 'signature') {
      const bytes = Buffer.from(record.wireBase64, 'base64'); bytes[1] ^= 1;
      record.wireBase64 = bytes.toString('base64'); record.wireSha256 = hash(bytes).toString('hex');
    }
    if (mode === 'alt') f.table.state.addresses[0] = key(99);
    if (mode === 'genesis') f.connection.getGenesisHash = async () => key(99).toBase58();
    await writeFile(path, mode === 'json' ? '{' : JSON.stringify(record));
    await assert.rejects(discover(f));
    await assert.rejects(readFile(f.store.ticketPath(f.plan, 'commit')), { code: 'ENOENT' });
  }
});

test('symlinks, permissive files, altered intent and stored-ticket corruption fail closed', async t => {
  for (const mode of ['signed-link', 'intent-link', 'ticket-link', 'mode', 'intent', 'ticket']) {
    const f = await setup(t), { ticket, slot } = await signed(f);
    const signedPath = resolve(slot.journalDirectory, `${ticket.signature}.signed.json`), intentPath = resolve(slot.directory, 'intent.json');
    const ticketPath = f.store.ticketPath(f.plan, 'commit');
    if (mode === 'signed-link' || mode === 'intent-link') {
      const path = mode === 'signed-link' ? signedPath : intentPath;
      const copy = resolve(f.directory, 'private-copy.json'); await writeFile(copy, await readFile(path), { mode: 0o600 });
      await unlink(path); await symlink(copy, path);
    }
    if (mode === 'ticket-link') await symlink(signedPath, ticketPath);
    if (mode === 'mode') await chmod(signedPath, 0o644);
    if (mode === 'intent') { const intent = JSON.parse(await readFile(intentPath)); intent.admin = key(99).toBase58(); await writeFile(intentPath, JSON.stringify(intent)); }
    if (mode === 'ticket') await writeFile(ticketPath, '{', { mode: 0o600 });
    await assert.rejects(discover(f));
  }
});

test('store roots and parent paths reject symlinks, permission changes and cross-deployment reopening', async t => {
  const f = await setup(t);
  await symlink(f.directory, resolve(f.directory, 'alias'));
  await assert.rejects(openApprovalStore({ ...f.options, directory: resolve(f.directory, 'alias/nested') }), /without symlinks/);
  await assert.rejects(openApprovalStore({ ...f.options, deploymentHash: '00'.repeat(32) }), /mismatch/);
  await chmod(f.directory, 0o755);
  await assert.rejects(f.store.begin(f.plan, 'commit'), /private/);
});
