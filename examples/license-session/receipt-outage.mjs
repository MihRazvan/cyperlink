#!/usr/bin/env node
/** Read-only real-local recovery of an existing payment; injected HTTP faults are test-only. */
import assert from 'node:assert/strict';
import { readFile, readdir, cp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPrivateRun, REPO } from '../../packages/local-client/src/runtime.mjs';
import { PolicySession } from '../../packages/policy-client/src/policy-session.mjs';
import { readOperationPlan, descriptorDigest } from '../../packages/policy-client/src/operation-plan.mjs';
import { validateOperation } from '../../packages/policy-client/src/sdk.mjs';
import { json, writeJson, sha } from '../policies/qualification/evidence.mjs';
const execute = promisify(execFile), [mode, ...args] = process.argv.slice(2);

if (mode === '--worker') {
  const [configPath, fault] = args, config = await json(configPath), calls = [];
  const originalFetch = globalThis.fetch;
  const allowed = new Set(['getVersion', 'getGenesisHash', 'getAccountInfo', 'getTransaction', 'getSignatureStatuses', 'getMultipleAccounts', 'isBlockhashValid', 'getBlockHeight']);
  globalThis.fetch = async (url, options) => {
    assert.equal(String(url), config.endpoint);
    const request = JSON.parse(options.body); assert(allowed.has(request.method), `Forbidden RPC: ${request.method}`);
    calls.push(request.method);
    if (request.method === 'getTransaction' && fault !== 'restored'
      || request.method === 'getSignatureStatuses' && fault === 'delivery-and-accounts'
      || request.method === 'getMultipleAccounts' && fault === 'delivery-and-accounts') return new Response('', { status: 503 });
    return originalFetch(url, options);
  };
  // Exercise the application's generated API, with no signer configuration.
  const { connectSession } = await import(pathToFileURL(config.bindings));
  const session = await connectSession(config);
  session.signers = session.signingClient = async () => { throw Error('Unexpected signing'); };
  const plan = await readOperationPlan(config.planPath);
  const result = await session.recover(plan, 'commit');
  console.log(JSON.stringify({ fault, calls, result }));
} else {
  assert.equal(mode, '--qualify', 'Usage: receipt-outage.mjs --qualify INSTANCE PAID_OPERATION NEW_OUTPUT');
  const [instancePath, operationPath, output] = args;
  const instance = await json(instancePath), planPath = resolve(operationPath, 'operation-plan.json'), plan = await readOperationPlan(planPath);
  const directory = await createPrivateRun(output);
  const results = { schema: 1, passed: false, classification: 'real-local-read-only-existing-payment-recovery-with-injected-http-faults',
    instancePath: resolve(instancePath), planPath, genesisHash: plan.genesisHash, scenarios: [], loadedPrograms: [], newTransactions: 0,
    limitations: ['Existing paid operation; no new payment or Arcium computation in this run.', 'Local trusted validator/program profile; no public-network or independent-operator claim.',
      'HTTP503 is a test-injected fault. Account snapshots are genuine live reads.', 'Committed account effect does not prove the retained signature landed while its receipt is unavailable.'] };
  const save = () => writeJson(resolve(directory, 'results.json'), results);
  await save();
  try {
    const config = { deployment: instance.descriptor, moduleRoot: instance.moduleRoot, endpoint: instance.endpoint,
      directory: resolve(directory, 'approvals'), planPath, bindings: resolve(instance.releaseDirectory, '../../bindings.mjs') };
    const session = await PolicySession.connect(config);
    const intent = await session.store.begin(plan, 'commit');
    const originalJournal = resolve(`${operationPath}-approvals`, `${descriptorDigest(plan.descriptor)}-commit/signing/transaction-journal`);
    async function hashes(path) {
      return Object.fromEntries(await Promise.all((await readdir(path)).sort().map(async name => [name, sha(await readFile(resolve(path, name))).toString('hex')])));
    }
    const originalHashes = await hashes(originalJournal);
    await cp(originalJournal, intent.journalDirectory, { recursive: true, force: false, errorOnExist: true });
    const ticket = await session.discoverApproval(plan, 'commit');
    results.signature = ticket.signature; results.wireSha256 = ticket.wireSha256;
    results.originalJournalHashes = originalHashes;
    const { template } = validateOperation(plan.descriptor), d = plan.descriptor;
    const keys = [d.job, d.permit, d.quota, d.effect, template.source, template.destination].map(address => new session.web3.PublicKey(address));
    const before = await session.connection.getMultipleAccountsInfoAndContext(keys, { commitment: 'confirmed' });
    const state = value => value.map(a => a && ({ owner: a.owner.toBase58(), data: a.data.toString('base64'), lamports: a.lamports, executable: a.executable }));
    results.before = { slot: before.context.slot, accounts: state(before.value) };
    const configPath = resolve(directory, 'worker.json'); await writeJson(configPath, config);
    for (const fault of ['receipt-only', 'delivery-and-accounts', 'restored']) {
      const { stdout } = await execute(process.execPath, [resolve(REPO, 'examples/license-session/receipt-outage.mjs'), '--worker', configPath, fault], { cwd: REPO, maxBuffer: 4 * 1024 * 1024 });
      const scenario = JSON.parse(stdout); results.scenarios.push(scenario); await save();
      const { delivery, observation } = scenario.result;
      assert.equal(delivery.signature, ticket.signature); assert.equal(delivery.wireSha256, ticket.wireSha256); assert.equal(delivery.canBroadcast, false);
      assert(scenario.calls.includes('getMultipleAccounts'));
      assert.equal(observation.status, fault === 'delivery-and-accounts' ? 'unresolved' : 'committed');
      if (fault === 'restored') {
        assert(['landed', 'expired-unresolved'].includes(delivery.status));
        if (delivery.status === 'landed') assert.equal(delivery.receipt.error, null);
        else results.restoreLimitation = 'Original receipt/status pruned by local validator; restored RPC returns null, exact signature remains expired-unresolved while live bound account effect is committed.';
      }
      else { assert.equal(delivery.receipt, undefined); assert(delivery.availability.length); }
      if (fault === 'delivery-and-accounts') {
        assert.equal(delivery.status, 'delivery-unavailable');
        assert(observation.minContextSlot >= results.scenarios[0].result.observation.slot);
      }
    }
    const after = await session.connection.getMultipleAccountsInfoAndContext(keys, { commitment: 'confirmed', minContextSlot: results.scenarios.at(-1).result.observation.slot });
    results.after = { slot: after.context.slot, accounts: state(after.value) };
    assert.deepEqual(results.after.accounts, results.before.accounts);
    assert.deepEqual(await hashes(originalJournal), originalHashes);
    const copiedHashes = await hashes(intent.journalDirectory);
    for (const [name, hash] of Object.entries(originalHashes)) assert.equal(copiedHashes[name], hash);
    assert.deepEqual(Object.keys(copiedHashes).filter(name => name.includes('.attempt-')), Object.keys(originalHashes).filter(name => name.includes('.attempt-')));
    assert.equal(new Set(results.scenarios.map(s => s.result.delivery.attempts)).size, 1);
    for (const [index, p] of (await json(instance.results)).loadedPrograms.entries()) {
      const path = resolve(directory, `loaded-${index}.json`);
      await execute('python3', ['scripts/verify_loaded_program.py', '--program-id', p.program, '--elf', p.local_elf_path, '--rpc', instance.endpoint, '--output', path]);
      const report = await json(path); assert(report.matched); assert.equal(report.genesis_hash, results.genesisHash); results.loadedPrograms.push(report);
    }
    assert.equal(results.loadedPrograms.length, 10);
    results.passed = true; await save();
    console.log(JSON.stringify({ passed: true, results: resolve(directory, 'results.json'), signature: ticket.signature, freshProcesses: 3,
      unchangedAccounts: keys.length, loadedElfs: results.loadedPrograms.length, newTransactions: 0 }));
  } catch (error) { results.failure = { message: error.message, stack: error.stack }; await save(); throw error; }
}
