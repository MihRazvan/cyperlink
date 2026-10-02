#!/usr/bin/env node
/** Capture actual local runtime callback receipts; keyless reads, no independent BLS verification claim. */
import assert from 'node:assert/strict';
import { createHash, verify } from 'node:crypto';
import { readFile, realpath, stat, access } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { privateJson } from './store.mjs';
import { REPO, loadWeb3, loopbackEndpoint, writeNew } from '../../packages/local-client/src/runtime.mjs';
import { validateOperationPlan } from '../../packages/local-client/src/operation-plan.mjs';
import { INITIAL_PROFILE as P, validateOperation, LocalRpcTransport, reconcileOperation, decodeJob, decodePermit } from '../../packages/sdk/src/index.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
export function verifyRuntimeSignatures(tx, base58) {
  const message = Buffer.from(tx.transaction.message.serialize()), required = tx.transaction.message.header.numRequiredSignatures;
  assert.equal(tx.transaction.signatures.length, required); assert(required > 0);
  const signers = tx.transaction.message.staticAccountKeys.slice(0, required);
  for (let i = 0; i < required; i++) {
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), signers[i].toBuffer()]);
    assert(verify(null, message, { key: spki, format: 'der', type: 'spki' }, base58.decode(tx.transaction.signatures[i])), 'Invalid runtime transaction signature');
  }
  return signers;
}
export function verifyCallbackOutput(output, commitment) {
  assert(output, 'Expected successful signed runtime output');
  assert.equal(typeof output.field_1, 'boolean');
  assert(Buffer.from(output.field_0).equals(Buffer.from(commitment)), 'Callback disclosed commitment differs from native authorized amount');
  assert(Array.isArray(output.field_2) && output.field_2.length === 32 && output.field_2.every(value => Number.isInteger(value) && value >= 0 && value <= 255));
  return { authorizedDecision: output.field_1, successorCiphertextHex: Buffer.from(output.field_2).toString('hex') };
}
export function verifyCallbackAccounts(accountMap, plan, admission) {
  for (const [name, address] of Object.entries({ job: plan.descriptor.job, computation_account: plan.descriptor.computation,
    quota: plan.descriptor.quota, permit: plan.descriptor.permit, policy_program: P.policy, admission })) assert.equal(accountMap[name], address, `Callback ${name} differs from retained operation`);
}
export function verifyCallbackTransaction({ transaction: tx, plan, web3, coder, definition, base58 }) {
  assert.equal(tx.meta.err, null);
  const signers = verifyRuntimeSignatures(tx, base58);
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
  const instructions = tx.transaction.message.compiledInstructions.filter(ix => keys.get(ix.programIdIndex).toBase58() === P.auth && Buffer.from(ix.data).subarray(0, 8).equals(Buffer.from(definition.discriminator)));
  assert.equal(instructions.length, 1, 'Require one exact authenticated budget callback');
  const instruction = instructions[0]; assert.equal(instruction.accountKeyIndexes.length, definition.accounts.length);
  const accountMap = Object.fromEntries(definition.accounts.map((entry, i) => [entry.name, keys.get(instruction.accountKeyIndexes[i]).toBase58()]));
  const admission = web3.PublicKey.findProgramAddressSync([Buffer.from('admission')], new web3.PublicKey(P.auth))[0].toBase58();
  verifyCallbackAccounts(accountMap, plan, admission);
  const decoded = coder.decode(Buffer.from(instruction.data));
  assert.equal(decoded.name, definition.name);
  const output = verifyCallbackOutput(decoded.data.output.Success?.[0], validateOperation(plan.descriptor).template.amountCommitment);
  return { signature: tx.transaction.signatures[0], slot: tx.slot, job: plan.descriptor.job, computation: plan.descriptor.computation,
    ...output, callbackInstructionSha256: sha(Buffer.from(instruction.data)),
    verifiedTransactionSigners: signers.map(key => key.toBase58()), landedCU: tx.meta.computeUnitsConsumed, feeLamports: tx.meta.fee };
}
export async function captureCallbacks({ bootstrapPath, sessionPath, output }) {
  const directory = resolve(sessionPath), target = resolve(output);
  assert(directory.startsWith(resolve(REPO, '.local') + sep) && await realpath(directory) === directory);
  const info = await stat(directory); assert(info.isDirectory() && !(info.mode & 0o077) && info.uid === process.getuid());
  assert.equal(dirname(target), directory, 'Callback output must be in the selected private session');
  try { await access(target); throw Error('Output already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const bootstrap = await privateJson(bootstrapPath), state = await privateJson(resolve(directory, 'state.json'));
  assert.equal(bootstrap.qualification, 'bootstrap-only-not-purchase'); assert.equal(bootstrap.genesisHash, state.genesis);
  const endpoint = loopbackEndpoint(bootstrap.endpoint), web3 = await loadWeb3(bootstrap.moduleRoot), require = createRequire(resolve(bootstrap.moduleRoot, 'package.json'));
  const bs = require('bs58'), base58 = bs.default ?? bs, { BorshInstructionCoder } = require('@anchor-lang/core');
  const idlRaw = await readFile(bootstrap.idl); assert.equal(sha(idlRaw), bootstrap.idlSha256);
  const idl = JSON.parse(idlRaw), coder = new BorshInstructionCoder(idl), definition = idl.instructions.find(ix => ix.name === 'runtime_budget_bound_callback'); assert(definition);
  const connection = new web3.Connection(endpoint, { commitment: 'confirmed', disableRetryOnRateLimit: true, fetch: async(url, options) => {
    assert.equal(loopbackEndpoint(url), endpoint); const body = JSON.parse(options.body);
    assert(['getGenesisHash', 'getSignaturesForAddress', 'getTransaction', 'getMultipleAccounts'].includes(body.method));
    return fetch(url, { ...options, redirect: 'error' });
  } });
  assert.equal(await connection.getGenesisHash(), bootstrap.genesisHash);
  const callbacks = [], receipts = [];
  for (const operation of state.operations) {
    assert(/^[a-f0-9-]{36}$/.test(operation.id), 'Unsafe operation identifier');
    if (!operation.tickets?.query) continue;
    const path = resolve(directory, `operation-${operation.id}`, 'operation-plan.json');
    const plan = validateOperationPlan(await privateJson(path)); assert.equal(sha(await readFile(path)), operation.planHash); assert.equal(plan.genesisHash, bootstrap.genesisHash);
    const candidates = await connection.getSignaturesForAddress(new web3.PublicKey(plan.descriptor.job), { limit: 100 }, 'confirmed');
    const found = [];
    for (const candidate of candidates) {
      if (candidate.err) continue;
      const tx = await connection.getTransaction(candidate.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (!tx || tx.meta.err) continue;
      const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
      if (!tx.transaction.message.compiledInstructions.some(ix => keys.get(ix.programIdIndex).toBase58() === P.auth && Buffer.from(ix.data).subarray(0, 8).equals(Buffer.from(definition.discriminator)))) continue;
      const checked = verifyCallbackTransaction({ transaction: tx, plan, web3, coder, definition, base58 });
      assert.equal(candidate.signature, checked.signature); found.push({ checked, tx });
    }
    assert.equal(found.length, 1, 'Expected one actual successful callback for each queued operation');
    for (const field of ['landedCU', 'feeLamports']) assert(Number.isSafeInteger(found[0].checked[field]) && found[0].checked[field] >= 0);
    const snapshot = await new LocalRpcTransport(endpoint, { commitment: 'confirmed' }).readAccounts(
      [plan.descriptor.job, plan.descriptor.permit, plan.descriptor.quota, plan.descriptor.effect], { minContextSlot: found[0].tx.slot });
    const observation = reconcileOperation(plan.descriptor, snapshot), job = decodeJob(snapshot.accounts[0].data), permit = decodePermit(snapshot.accounts[1].data);
    assert.equal(job.status, found[0].checked.authorizedDecision ? 1 : 2);
    if (found[0].checked.authorizedDecision) {
      assert.equal(permit.decision, 1);
      assert.equal(Buffer.from(permit.bytes).subarray(480, 512).toString('hex'), found[0].checked.successorCiphertextHex);
    } else { assert(permit.empty); assert.equal(observation.status, 'denied'); }
    found[0].checked.observedJobStatus = job.status; found[0].checked.observedOperationStatus = observation.status;
    found[0].checked.observationSlot = snapshot.slot;
    callbacks.push(found[0].checked); receipts.push({ operationId: operation.id, ...found[0].checked, snapshot, transaction: found[0].tx });
  }
  assert(callbacks.length > 0); assert.equal(await connection.getGenesisHash(), bootstrap.genesisHash);
  const raw = Buffer.from(JSON.stringify({ schema: 1, genesisHash: bootstrap.genesisHash, receipts }, null, 2) + '\n');
  const rawPath = target + '.receipts.json'; await writeNew(rawPath, raw);
  const report = { schema: 1, passed: true, evidenceLevel: 'read-only-live-local-runtime-callback-receipts', genesisHash: bootstrap.genesisHash,
    callbacks, rawReceiptSha256: sha(raw), rawReceiptBytes: raw.length,
    validatorCost: { category: 'arcium-signed-callback', transactions: callbacks.length,
      landedCU: callbacks.reduce((sum, item) => sum + item.landedCU, 0), feeLamports: callbacks.reduce((sum, item) => sum + item.feeLamports, 0) },
    limitations: ['Actual transaction Ed25519 signatures and exact auth callback discriminator/Job/computation/account association are verified.',
      'The loaded auth program verifies runtime signed output; this helper does not independently verify BLS or re-execute distributed computation.',
      'Disclosed policy decisions and public transaction/account data are retained. No native account secrets or witnesses are loaded; requested amounts are not exported or used by callback verification.',
      'CU/fees are validator callback costs only; distributed worker CPU/network costs are unmeasured. Confirmed RPC evidence is not a historical state proof.'] };
  await writeNew(target, JSON.stringify(report, null, 2) + '\n'); return report;
}
async function main() {
  const options = {}, args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) { assert(['--bootstrap', '--session', '--out'].includes(args[i]) && args[i + 1] && !options[args[i]]); options[args[i]] = args[i + 1]; }
  assert(options['--bootstrap'] && options['--session'] && options['--out']);
  const report = await captureCallbacks({ bootstrapPath: options['--bootstrap'], sessionPath: options['--session'], output: options['--out'] });
  console.log(JSON.stringify({ passed: true, callbacks: report.callbacks.length, validatorCost: report.validatorCost }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
