import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, chmod, symlink, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { REPO, loadWeb3, loopbackEndpoint, saveSigner, loadSigner, createPrivateRun, LocalSession, PROOF_PROGRAM } from '../src/runtime.mjs';
import { verifyPreparedProof } from '../src/proofs.mjs';
const moduleRoot = process.env.CYPERLINK_JS_MODULE_ROOT ?? '/Users/razvan/Repos/colosseum/research/cyperlink-probes-2026-10-01/authenticated/cyperlink_auth';
const web3 = await loadWeb3(moduleRoot);
async function scratch(t) {
  await mkdir(resolve(REPO, '.local'), { recursive: true });
  const path = await mkdtemp(resolve(REPO, '.local/local-client-test-')); await chmod(path, 0o700);
  t.after(() => rm(path, { recursive: true })); return path;
}
test('local-only network and private run path boundaries', async () => {
  for (const endpoint of ['https://api.devnet.solana.com', 'http://127.0.0.1.evil.test', 'http://user:pass@localhost', 'http://127.0.0.1?token=secret']) assert.throws(() => loopbackEndpoint(endpoint));
  assert.equal(loopbackEndpoint('http://localhost:8899'), 'http://127.0.0.1:8899/');
  await assert.rejects(createPrivateRun('/tmp/cyperlink-signers'), /beneath/);
});
test('disposable signing files refuse overwrite, broad permissions and symlinks', async t => {
  const dir = await scratch(t), key = web3.Keypair.generate(), path = resolve(dir, 'owner.json');
  await saveSigner(path, key); assert((await loadSigner(path, web3)).publicKey.equals(key.publicKey));
  await assert.rejects(saveSigner(path, key), /EEXIST/);
  await chmod(path, 0o644); await assert.rejects(loadSigner(path, web3), /private/);
  await chmod(path, 0o600); await symlink(path, resolve(dir, 'link.json'));
  await assert.rejects(loadSigner(resolve(dir, 'link.json'), web3));
});
test('signed send verifies all signatures, wire bounds and actual landed message', async t => {
  const dir = await scratch(t), payer = web3.Keypair.generate(), receiver = web3.Keypair.generate();
  const session = new LocalSession({ web3, endpoint: 'http://127.0.0.1:8899', payer, directory: dir });
  let wire, simulateCount = 0;
  session.connection = {
    getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 100 }),
    simulateTransaction: async (tx, options) => { simulateCount++; assert.equal(options.sigVerify, true); return { value: { err: null, unitsConsumed: 100 } }; },
    sendRawTransaction: async bytes => { wire = bytes; return 'mocked-signature'; },
    getSignatureStatuses: async () => ({ value: [{ confirmationStatus: 'confirmed' }] }),
    getTransaction: async () => ({ slot: 7, meta: { err: null, computeUnitsConsumed: 110 }, transaction: web3.VersionedTransaction.deserialize(wire) }),
  };
  const ix = web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: receiver.publicKey, lamports: 1 });
  const result = await session.send('unit-transfer', [ix]); assert.equal(result.signaturesVerified, true); assert.equal(result.slot, 7); assert.equal(simulateCount, 1);
  const recorded = JSON.parse(await readFile(resolve(dir, '000-unit-transfer-landed.json'))); assert.equal(recorded.signature, 'mocked-signature');
  session.connection.getTransaction = async () => ({ slot: 7, meta: { err: null }, transaction: { message: { serialize: () => Buffer.from('wrong') } } });
  await assert.rejects(session.send('wrong-landed', [ix]), /differs/);
});
test('failed genuine-signature simulation does not submit a transaction', async t => {
  const dir = await scratch(t), payer = web3.Keypair.generate();
  const session = new LocalSession({ web3, endpoint: 'http://127.0.0.1:8899', payer, directory: dir });
  let sent = false;
  session.connection = { getLatestBlockhash: async () => ({ blockhash: '11111111111111111111111111111111', lastValidBlockHeight: 1 }),
    simulateTransaction: async () => ({ value: { err: 'test-rejection' } }), sendRawTransaction: async () => { sent = true; } };
  await assert.rejects(session.send('reject', []), /Simulation/); assert.equal(sent, false);
});
test('buffer orchestration uploads exact bytes and closes only after native verification', async () => {
  const context = web3.Keypair.generate(), owner = web3.Keypair.generate(), buffer = web3.Keypair.generate();
  const program = new web3.PublicKey(Buffer.alloc(32, 89)).toBase58(), raw = Buffer.alloc(1100, 23), stored = Buffer.alloc(raw.length), calls = [];
  const proof = { name: 'range', context_address: context.publicKey.toBase58(), context_account_size: 297, proof_data: raw.toString('hex'),
    verify_instruction: { program: PROOF_PROGRAM, data: Buffer.concat([Buffer.from([7]), raw]).toString('hex'), accounts: [
      { key: context.publicKey.toBase58(), signer: false, writable: true }, { key: owner.publicKey.toBase58(), signer: false, writable: false }] } };
  const session = { web3, payer: owner, connection: { getAccountInfo: async () => ({ owner: new web3.PublicKey(program), data: stored }) },
    createAccount: async (...args) => calls.push(['create', args[0].publicKey.toBase58(), args[1], args[2]]),
    send: async (label, [ix]) => {
      calls.push([label, ix]);
      if (label.startsWith('upload-proof')) ix.data.subarray(5).copy(stored, ix.data.readUInt32LE(1));
      return { label };
    } };
  await verifyPreparedProof(session, proof, context, { bufferSigner: buffer, bufferProgram: program });
  assert(stored.equals(raw)); assert.equal(calls.at(-1)[0], 'close-proof-buffer');
  const verify = calls.find(([label]) => label === 'verify-proof-range')[1];
  assert.deepEqual([...verify.data], [7, 0, 0, 0, 0]); assert(verify.keys[0].pubkey.equals(buffer.publicKey));
  const prior = session.send; session.send = async (label, ixs) => { if (label.startsWith('verify-proof')) throw Error('native verification rejected'); return prior(label, ixs); };
  calls.length = 0;
  await assert.rejects(verifyPreparedProof(session, proof, context, { bufferSigner: buffer, bufferProgram: program }), /native verification/);
  assert(!calls.some(([label]) => label === 'close-proof-buffer'));
});
