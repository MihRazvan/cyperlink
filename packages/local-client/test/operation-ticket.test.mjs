import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { loadWeb3, REPO, TOKEN_PROGRAM } from '../src/runtime.mjs';
import { descriptorDigest, queryStateDigest, hash, le } from '../src/operation-plan.mjs';
import { instructionJSON, validateOperationTicket } from '../src/operation-ticket.mjs';
import { LocalOperationClient } from '../src/operation-client.mjs';
import { INITIAL_PROFILE as P, buildActionTemplate, buildMerchantDigest, publicKeyBytes } from '../../sdk/src/index.mjs';

const web3 = await loadWeb3(process.env.CYPERLINK_JS_MODULE_ROOT ?? resolve(REPO, '.local/toolchain/js'));
const require = createRequire(resolve(REPO, '.local/toolchain/js/package.json'));
const anchor = require('@anchor-lang/core'), ar = require('@arcium-hq/client'), BN = require('bn.js');
const key = byte => new web3.PublicKey(Buffer.alloc(32, byte));
// Synthetic host intent and signed transactions only: no native proof or validator claim.
function fixture({ lookup = false } = {}) {
  const admin = web3.Keypair.generate(), owner = web3.Keypair.generate(), source = key(13), mint = key(14), destination = key(15), effect = web3.PublicKey.findProgramAddressSync([Buffer.from('purchase'), owner.publicKey.toBuffer(), le(42n)], new web3.PublicKey(P.merchant))[0];
  const proofKeys = [key(17), key(18), key(19)], nativeData = Buffer.from([27, 7, 1]), sourceData = Buffer.from([1, 2]), proofData = [Buffer.from([3]), Buffer.from([4]), Buffer.from([5])];
  const quota = Buffer.alloc(161); quota[128] = 1; admin.publicKey.toBuffer().copy(quota, 96); quota[56] = 9; hash(quota.subarray(40, 88)).copy(quota, 8);
  const digest = buildMerchantDigest({ effect: effect.toBuffer(), sku: '42', owner: owner.publicKey.toBuffer(), destination: destination.toBuffer(), mint: mint.toBuffer() });
  const template = Buffer.alloc(520);
  buildActionTemplate({ source: source.toBuffer(), mint: mint.toBuffer(), destination: destination.toBuffer(), owner: owner.publicKey.toBuffer(), sourceData, nativeData,
    proofKeys: proofKeys.map(k => k.toBuffer()), proofData, newSource: Buffer.alloc(64, 1), commitment: Buffer.alloc(32, 2), quota: publicKeyBytes(P.quota), consumer: publicKeyBytes(P.merchant), consumerContract: digest }).copy(template);
  quota.subarray(8, 40).copy(template, 16); le(1n, 16).copy(template, 464); le(100n).copy(template, 512);
  const query = { offset: '2', expiry: '100', publicKeyHex: Buffer.alloc(32, 21).toString('hex'), clientNonceHex: Buffer.alloc(16, 22).toString('hex'), amountCiphertextHex: Buffer.alloc(32, 23).toString('hex'), openingCiphertextHex: Buffer.alloc(32, 24).toString('hex') };
  const inputsHash = hash(Buffer.from(query.publicKeyHex, 'hex'), Buffer.from(query.clientNonceHex, 'hex'), Buffer.from(query.amountCiphertextHex, 'hex'), Buffer.from(query.openingCiphertextHex, 'hex'), quota.subarray(40, 88), le(1n, 16), Buffer.alloc(32, 2));
  const descriptor = { profile: P.name, consumerKind: 'merchant', job: key(25).toBase58(), computation: key(26).toBase58(), permit: key(27).toBase58(), owner: owner.publicKey.toBase58(), admin: admin.publicKey.toBase58(), quota: P.quota, effect: effect.toBase58(), sku: '42', templateHex: template.toString('hex'), queryStateHashHex: queryStateDigest(quota).toString('hex'), inputsHashHex: inputsHash.toString('hex') };
  const plan = { mxePublicKeyHex: '01'.repeat(32), schema: 1, contextSlot: 1, label: 'host', genesisHash: key(30).toBase58(), action: key(31).toBase58(), descriptor, query, quotaSnapshotHex: quota.toString('hex'), binding: { nativeDataHex: nativeData.toString('hex'), sourceDataHex: sourceData.toString('hex'), proofAddresses: proofKeys.map(k => k.toBase58()), proofDataHex: proofData.map(p => p.toString('hex')) } };
  const H = new web3.PublicKey(P.policy), G = key(81), consumer = new web3.PublicKey(P.merchant);
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
  const connection = { getAddressLookupTable: async () => ({ context: { slot: 2 }, value: table }) };
  return { plan, instruction, recordFor, connection, table, owner, admin };
}

test('exact signed native operation intent passes with and without ALT', async () => {
  for (const lookup of [false, true]) {
    const f = fixture({ lookup });
    const result = await validateOperationTicket(f.plan, f.recordFor(), web3, f.connection);
    assert.equal(result.liveLookupTablesChecked, lookup ? 1 : 0);
  }
});

test('valid signatures and forged descriptor metadata do not authorize another destination or instruction', async () => {
  for (const mutation of ['destination', 'data', 'program']) {
    const f = fixture({ lookup: true }), changed = new web3.TransactionInstruction({ ...f.instruction, keys: f.instruction.keys.map(k => ({ ...k })), data: Buffer.from(f.instruction.data) });
    if (mutation === 'destination') changed.keys[7].pubkey = key(61);
    if (mutation === 'data') changed.data[1] ^= 1;
    if (mutation === 'program') changed.programId = key(62);
    const record = f.recordFor([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1300000 }), changed]);
    await assert.rejects(validateOperationTicket(f.plan, record, web3, f.connection), /differs from retained intent/);
  }
});

test('extra instruction and altered compute fee instruction cannot hide behind operation metadata', async () => {
  const f = fixture({ lookup: true });
  await assert.rejects(validateOperationTicket(f.plan, f.recordFor([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1300000 }), f.instruction,
    web3.SystemProgram.transfer({ fromPubkey: f.admin.publicKey, toPubkey: key(63), lamports: 1 })]), web3, f.connection), /only compute limit/);
  await assert.rejects(validateOperationTicket(f.plan, f.recordFor([web3.ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 100 }), f.instruction]), web3, f.connection), /compute budget/);
});

test('live ALT mapping must agree before a ticket may be broadcast', async () => {
  const f = fixture({ lookup: true }), record = f.recordFor();
  f.table.state.addresses[0] = key(64);
  await assert.rejects(validateOperationTicket(f.plan, record, web3, f.connection), /Live ALT resolution/);
});

test('modified plan instruction bytes cannot change native action semantics', async () => {
  const f = fixture({ lookup: true }), record = f.recordFor();
  f.plan.instructions.commit.data = '00' + f.plan.instructions.commit.data.slice(2);
  await assert.rejects(validateOperationTicket(f.plan, record, web3, f.connection), /differ from operation semantics/);
});

test('changed payer and corrupted signature rejected even if record metadata matches', async () => {
  const f = fixture({ lookup: true });
  await assert.rejects(validateOperationTicket(f.plan, f.recordFor(undefined, f.owner), web3, f.connection), /fee payer/);
  const record = f.recordFor(), wire = Buffer.from(record.wireBase64, 'base64'); wire[1] ^= 1;
  record.wireBase64 = wire.toString('base64'); record.wireSha256 = hash(wire).toString('hex');
  await assert.rejects(validateOperationTicket(f.plan, record, web3, f.connection), /Invalid signed operation signature/);
});

test('actual pinned Anchor query builder passes and changed expected query snapshot is rejected', async () => {
  const f = fixture({ lookup: true });
  const connection = new web3.Connection('http://127.0.0.1:8899');
  const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(f.admin), { commitment: 'confirmed' });
  const idl = JSON.parse(await readFile(resolve(REPO, 'programs/auth/target/idl/cyperlink_auth.json')));
  const program = new anchor.Program(idl, provider);
  const client = new LocalOperationClient({ session: { web3, endpoint: connection.rpcEndpoint, payer: f.admin }, provider, program, ar, BN });
  const acc = client.accounts(new BN(f.plan.query.offset));
  f.plan.descriptor.job = acc.job.toBase58(); f.plan.descriptor.computation = acc.computationAccount.toBase58();
  const query = await client.queryInstruction(f.plan);
  f.plan.instructions.query = instructionJSON(query);
  f.table.state.addresses = query.keys.map(meta => meta.pubkey);
  const record = f.recordFor([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1300000 }), query]); record.role = 'query';
  await validateOperationTicket(f.plan, record, web3, f.connection);
  const changed = new web3.TransactionInstruction({ ...query, data: Buffer.from(query.data) }); changed.data[changed.data.length - 1] ^= 1;
  const wrong = f.recordFor([web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1300000 }), changed]); wrong.role = 'query';
  await assert.rejects(validateOperationTicket(f.plan, wrong, web3, f.connection), /differs from retained intent/);
});
