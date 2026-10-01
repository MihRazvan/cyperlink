#!/usr/bin/env node
// Real loopback-validator provisioning tests. Negative cases are signed
// simulations, explicitly distinct from the broadcast buffer lifecycle.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, writeFile, rename, mkdir, access } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { LocalSession, loadWeb3, loopbackEndpoint } from '../../packages/local-client/src/runtime.mjs';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const run = resolve(process.env.CYPERLINK_PROVISIONING_TEST_RUN ?? resolve(repo, '.local/replay-consumers-conflict-v3'));
assert(run.startsWith(resolve(repo, '.local') + '/'), 'Only repository-local evidence paths are allowed');
const preparation = JSON.parse(await readFile(resolve(run, 'preparation.json'), 'utf8'));
const app = preparation.app;
const moduleRoot = process.env.CYPERLINK_JS_MODULE_ROOT ?? app;
const require = createRequire(resolve(moduleRoot, 'package.json'));
const web3 = await loadWeb3(moduleRoot);
const anchor = require('@anchor-lang/core');
const base58 = require('bs58');
const encode = (base58.default ?? base58).encode;
const { PublicKey, Keypair, SystemProgram, TransactionInstruction, ComputeBudgetProgram, TransactionMessage, VersionedTransaction } = web3;
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(resolve(app, 'local-test-wallet.json'), 'utf8'))));
const endpoint = loopbackEndpoint(preparation.rpc);
assert.equal(endpoint, 'http://127.0.0.1:8899/');
const reportPath = resolve(run, 'provisioning-negatives.json');
try { await access(reportPath); throw Error(`Refusing to overwrite existing evidence ${reportPath}`); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const directory = resolve(run, `provisioning-negative-transactions-${randomBytes(4).toString('hex')}`);
await mkdir(directory, { mode: 0o700 });
const session = new LocalSession({ web3, endpoint, payer, directory });
const connection = session.connection;
const version = await session.assertLocalVersions();
const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: 'confirmed' });
const idl = JSON.parse(await readFile(resolve(app, 'target/idl/cyperlink_auth.json'), 'utf8'));
const program = new anchor.Program(idl, provider);
const H = new PublicKey(Buffer.alloc(32, 82)), merchant = new PublicKey(Buffer.alloc(32, 83)), license = new PublicKey(Buffer.alloc(32, 84)), bufferProgram = new PublicKey(Buffer.alloc(32, 89));
const quota = PublicKey.findProgramAddressSync([Buffer.from('quota')], H)[0];
const admission = PublicKey.findProgramAddressSync([Buffer.from('admission')], program.programId)[0];
const loader = new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111');
const programData = PublicKey.findProgramAddressSync([program.programId.toBuffer()], loader)[0];
const report = { scope: 'real-local-validator provisioning only; no native proof, MPC, token transfer or permit claim',
  rpc: endpoint, version, startedAt: new Date().toISOString(), transactionDirectory: directory,
  programs: { auth: program.programId.toBase58(), policy: H.toBase58(), merchant: merchant.toBase58(), license: license.toBase58(), proofBuffer: bufferProgram.toBase58() },
  simulations: [], transactions: [], completed: false };
const save = async () => { const temporary = reportPath + '.tmp'; await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', { mode: 0o600 }); await rename(temporary, reportPath); };
await save();
function meta(pubkey, isSigner = false, isWritable = false) { return { pubkey, isSigner, isWritable }; }
function hash(data) { return createHash('sha256').update(data).digest('hex'); }
async function simulate(name, instruction, signers, expected) {
  const latest = await connection.getLatestBlockhash('confirmed');
  const tx = new VersionedTransaction(new TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: latest.blockhash,
    instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 300000 }), instruction] }).compileToV0Message());
  tx.sign([...new Map([payer, ...signers].map(s => [s.publicKey.toBase58(), s])).values()]);
  const result = await connection.simulateTransaction(tx, { sigVerify: true, commitment: 'confirmed' });
  const evidence = { name, classification: 'signed-simulation-only', sigVerify: true, broadcast: false, slot: result.context.slot,
    transactionSignature: encode(tx.signatures[0]), signedTransactionBase64: Buffer.from(tx.serialize()).toString('base64'),
    error: result.value.err, logs: result.value.logs, unitsConsumed: result.value.unitsConsumed, expected };
  report.simulations.push(evidence); await save();
  assert.deepEqual(result.value.err, { InstructionError: [1, expected] }, name);
  return evidence;
}
async function broadcast(name, instructions, signers = []) {
  const evidence = await session.send(name, instructions, signers);
  report.transactions.push({ name, classification: 'broadcast-confirmed-local-transaction', ...evidence }); await save();
  return evidence;
}
function bufferWrite(buffer, offset, bytes, signer = true) {
  const data = Buffer.alloc(5 + bytes.length); data.writeUInt32LE(offset, 1); Buffer.from(bytes).copy(data, 5);
  return new TransactionInstruction({ programId: bufferProgram, keys: [meta(buffer, signer, true)], data });
}
async function bufferSnapshot(buffer) {
  const a = await connection.getAccountInfo(buffer, 'confirmed'); assert(a); return { owner: a.owner.toBase58(), lamports: a.lamports, data: a.data.toString('hex'), sha256: hash(a.data) };
}

try {
  for (const key of [program.programId, H, merchant, license, bufferProgram]) assert((await connection.getAccountInfo(key, 'confirmed'))?.executable, `Missing executable ${key}`);
  const outsider = Keypair.generate();
  const unauthorized = await program.methods.provisionQuota().accounts({ payer: outsider.publicKey, programData, quota, policyProgram: H, admission, systemProgram: SystemProgram.programId }).instruction();
  const denied = await simulate('auth-quota-unauthorized-administrator', unauthorized, [outsider], { Custom: 6001 });
  assert(!denied.logs.some(log => log.includes(`Program ${H.toBase58()} invoke`)), 'Auth must reject before policy CPI');
  const direct = await simulate('policy-quota-admission-pda-not-signing', new TransactionInstruction({ programId: H, data: Buffer.from([6]),
    keys: [meta(quota, false, true), meta(payer.publicKey, true, true), meta(admission), meta(SystemProgram.programId)] }), [], { Custom: 834 });
  direct.note = 'Combined provisioning authority/state guard. An already-created quota also rejects here; this case does not independently isolate its authority check.';

  const buyer = Keypair.generate();
  for (const consumer of [{ name: 'merchant', id: merchant, seed: 'purchase', semantic: randomBytes(8), authorityError: 1011, pdaError: 1012 },
    { name: 'license', id: license, seed: 'license', semantic: randomBytes(32), authorityError: 1111, pdaError: 1112 }]) {
    const record = PublicKey.findProgramAddressSync([Buffer.from(consumer.seed), buyer.publicKey.toBuffer(), consumer.semantic], consumer.id)[0];
    assert.equal(await connection.getAccountInfo(record, 'confirmed'), null);
    const data = Buffer.concat([Buffer.from([0]), consumer.semantic]);
    await simulate(`${consumer.name}-initialization-missing-buyer-signature`, new TransactionInstruction({ programId: consumer.id, data,
      keys: [meta(payer.publicKey, true, true), meta(buyer.publicKey), meta(record, false, true), meta(SystemProgram.programId)] }), [], { Custom: consumer.authorityError });
    const wrongRecord = Keypair.generate().publicKey;
    await simulate(`${consumer.name}-initialization-wrong-record-pda`, new TransactionInstruction({ programId: consumer.id, data,
      keys: [meta(payer.publicKey, true, true), meta(buyer.publicKey, true), meta(wrongRecord, false, true), meta(SystemProgram.programId)] }), [buyer], { Custom: consumer.pdaError });
    assert.equal(await connection.getAccountInfo(record, 'confirmed'), null);
    assert.equal(await connection.getAccountInfo(wrongRecord, 'confirmed'), null);
  }

  const buffer = Keypair.generate();
  const rent = await connection.getMinimumBalanceForRentExemption(32, 'confirmed');
  report.buffer = { address: buffer.publicKey.toBase58(), bytes: 32, rent, classification: 'ordinary-upload-storage-only; no native proof verification' };
  await broadcast('proof-buffer-create', [SystemProgram.createAccount({ fromPubkey: payer.publicKey, newAccountPubkey: buffer.publicKey, lamports: rent, space: 32, programId: bufferProgram })], [buffer]);
  const blank = await bufferSnapshot(buffer.publicKey); assert.equal(blank.data, Buffer.alloc(32).toString('hex'));
  await simulate('proof-buffer-write-without-buffer-key', bufferWrite(buffer.publicKey, 0, [1, 2, 3], false), [], 'MissingRequiredSignature');
  assert.deepEqual(await bufferSnapshot(buffer.publicKey), blank);
  await simulate('proof-buffer-write-out-of-bounds', bufferWrite(buffer.publicKey, 31, [1, 2]), [buffer], 'AccountDataTooSmall');
  assert.deepEqual(await bufferSnapshot(buffer.publicKey), blank);
  report.buffer.rejectedWritesLeftBytesAndLamportsUnchanged = true;
  const payload = Buffer.from('cyperlink-upload-test');
  await broadcast('proof-buffer-authorized-write', [bufferWrite(buffer.publicKey, 4, payload)], [buffer]);
  const written = await bufferSnapshot(buffer.publicKey); const expected = Buffer.alloc(32); payload.copy(expected, 4); assert.equal(written.data, expected.toString('hex'));
  report.buffer.authorizedWrite = { observedSha256: written.sha256, expectedSha256: hash(expected) };
  const refund = Keypair.generate().publicKey;
  const close = signer => new TransactionInstruction({ programId: bufferProgram, data: Buffer.from([1]), keys: [meta(buffer.publicKey, signer, true), meta(refund, false, true)] });
  await simulate('proof-buffer-close-without-buffer-key', close(false), [], 'MissingRequiredSignature');
  assert.deepEqual(await bufferSnapshot(buffer.publicKey), written);
  assert.equal(await connection.getAccountInfo(refund, 'confirmed'), null);
  await broadcast('proof-buffer-authorized-close', [close(true)], [buffer]);
  assert.equal(await connection.getAccountInfo(buffer.publicKey, 'confirmed'), null);
  const refunded = await connection.getAccountInfo(refund, 'confirmed'); assert(refunded); assert.equal(refunded.lamports, rent); assert(refunded.owner.equals(SystemProgram.programId));
  report.buffer.closure = { requiredBufferKey: true, accountRemoved: true, refundAddress: refund.toBase58(), refundedLamports: refunded.lamports };
  // A distinct refund account isolates this assertion from concurrent demo fees.
  report.completed = true; report.completedAt = new Date().toISOString(); await save();
  console.log(JSON.stringify({ report: reportPath, simulations: report.simulations.length, broadcastTransactions: report.transactions.length, completed: true }));
} catch (error) {
  report.failure = { message: error.message, stack: error.stack }; await save(); throw error;
}
