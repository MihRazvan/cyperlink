import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { loadWeb3, REPO } from '../../packages/local-client/src/runtime.mjs';
import { INITIAL_PROFILE as P } from '../../packages/sdk/src/index.mjs';
import { verifyRuntimeSignatures, verifyCallbackOutput, verifyCallbackAccounts } from './verify-session-callbacks.mjs';
const moduleRoot = process.env.CYPERLINK_JS_MODULE_ROOT ?? resolve(REPO, '.local/toolchain/js');
const web3 = await loadWeb3(moduleRoot), require = createRequire(resolve(moduleRoot, 'package.json'));
const bs = require('bs58'), base58 = bs.default ?? bs;
test('actual callback transaction signatures are independently verified and tampering fails', () => {
  const payer = web3.Keypair.generate(), other = web3.Keypair.generate();
  const message = new web3.TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: other.publicKey.toBase58(),
    instructions: [web3.SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: other.publicKey, lamports: 1 })] }).compileToV0Message();
  const signed = new web3.VersionedTransaction(message); signed.sign([payer]);
  const tx = { transaction: { message, signatures: signed.signatures.map(signature => base58.encode(signature)) } };
  assert.equal(verifyRuntimeSignatures(tx, base58)[0].toBase58(), payer.publicKey.toBase58());
  tx.transaction.signatures = [base58.encode(Buffer.alloc(64))]; assert.throws(() => verifyRuntimeSignatures(tx, base58), /Invalid runtime/);
});
test('callback output binds the disclosed native commitment and preserves explicit denial', () => {
  const commitment = Buffer.alloc(32, 3), output = { field_0: [...commitment], field_1: false, field_2: new Array(32).fill(4) };
  assert.equal(verifyCallbackOutput(output, commitment).authorizedDecision, false);
  assert.throws(() => verifyCallbackOutput(output, Buffer.alloc(32, 9)), /commitment differs/);
  assert.throws(() => verifyCallbackOutput({ ...output, field_1: 1 }, commitment));
  assert.throws(() => verifyCallbackOutput({ ...output, field_2: new Array(32).fill(256) }, commitment));
  assert.throws(() => verifyCallbackOutput(undefined, commitment), /successful signed/);
});
test('callback associations cannot substitute another Job, computation, permit or admission authority', () => {
  const plan = { descriptor: { job: 'job', computation: 'computation', quota: 'quota', permit: 'permit' } };
  const accounts = { job: 'job', computation_account: 'computation', quota: 'quota', permit: 'permit', policy_program: P.policy, admission: 'admission' };
  verifyCallbackAccounts(accounts, plan, 'admission');
  for (const key of Object.keys(accounts)) assert.throws(() => verifyCallbackAccounts({ ...accounts, [key]: 'changed' }, plan, 'admission'), /differs from retained/);
});
