#!/usr/bin/env node
/** Genuine local execution. Amounts below are synthetic test-observer disclosures. */
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readdir, readFile, realpath } from 'node:fs/promises';
import { createPrivateRun, REPO } from '../packages/local-client/src/runtime.mjs';
import { CyperLinkServiceClient } from '../packages/service-client/src/index.mjs';
import { validateOperation, decodeQuota } from '../packages/policy-client/src/sdk.mjs';
import { json, writeJson, sha, snapshot, unchanged, callback } from '../examples/policies/qualification/evidence.mjs';
import { verifyPaidTransition, signedMessage } from '../examples/policies/qualification/archive.mjs';

const execute = promisify(execFile);
const [instancePath, environment, output, continuation] = process.argv.slice(2);
assert(continuation === undefined || continuation === '--resume-after-runtime-failure', 'Unsupported qualification continuation');
assert(instancePath && environment && output, 'Usage: qualify_service.mjs INSTANCE ENVIRONMENT NEW_OUTPUT');
const instance = await json(instancePath), directory = continuation ? await realpath(output) : await createPrivateRun(output);
assert(directory.startsWith(resolve(REPO, '.local') + '/'));
const report = continuation ? await json(resolve(directory, 'results.json')) : { schema: 1, passed: false, classification: 'real-local-service-runtime-restart',
  deployment: instance.descriptor, genesisHash: instance.descriptor.genesisHash,
  observerDisclosures: { initialRemaining: 50, purchaseCap: 30, purchases: [10, 20] },
  runtime: [], api: [], callbacks: [], transactions: [], accountSnapshots: [], operations: [], checks: [],
  limitations: ['Two nodes and trusted dealer on one host', 'Graceful whole-stack restart, not host power loss or independent recovery operators', 'Local synthetic no-fee assets; explicit owner and administrator approval', 'HTTP provides keyless registration/observation/recovery, not remote preparation or signing'] };
if (continuation) {
  assert.equal(report.passed, false); assert(report.error && report.transactions.length === 1 && report.callbacks.length === 1, 'Continuation only supports first paid operation followed by runtime failure');
  assert.equal(report.genesisHash, instance.descriptor.genesisHash);
  await writeJson(resolve(directory, `failed-attempt-${sha(JSON.stringify(report)).toString('hex')}.json`), report);
  (report.attemptErrors ??= []).push(report.error); delete report.error;
}
const save = () => writeJson(resolve(directory, 'results.json'), report);
let running;
await save();
try {
  const bindings = await import(pathToFileURL(resolve(instance.releaseDirectory, '../../bindings.mjs')));
  const observer = await bindings.connect({ ...instance, deployment: instance.descriptor, directory: await createPrivateRun(resolve(directory, `observer-${randomBytes(8).toString('hex')}`)) });
  const { connection, web3 } = observer.session, { PublicKey } = web3;
  await observer.assertDeploymentState();
  const base58 = createRequire(resolve(instance.moduleRoot, 'package.json'))('@anchor-lang/core').utils.bytes.bs58;
  assert.equal(decodeQuota((await connection.getAccountInfo(observer.Q)).data).version, continuation ? 1n : 0n);
  const operations = ['before-restart', 'after-restart'].map(label => ({ label, directory: resolve(directory, label), approvalsDirectory: resolve(directory, `${label}-approvals`) }));
  const source = { instancePath: resolve(instancePath), workspaceDirectory: resolve(directory, 'workspace'),
    operationSources: Object.fromEntries(operations.map(op => [op.label, { directory: op.directory, approvalsDirectory: op.approvalsDirectory }])) };
  const serviceOptions = { directory: resolve(directory, 'service'), sources: { local: source }, token: randomBytes(32).toString('hex'), port: 0 };
  async function open() {
    const config = resolve(directory, 'service-config.json');
    await writeJson(config, { schema: 1, ...serviceOptions });
    const child = spawn(process.execPath, ['packages/policy-cli/cyperlink.mjs', 'service', '--config', config], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
    const exited = new Promise(done => child.once('exit', (code, signal) => done({ code, signal })));
    running = { close: async () => {
      child.kill('SIGTERM'); const result = await exited; assert.equal(result.code, 0, 'Service did not close gracefully');
    } };
    const endpoint = await new Promise((done, fail) => {
      let buffer = ''; const timer = setTimeout(() => fail(Error('Service startup timeout')), 30_000);
      child.once('error', error => { clearTimeout(timer); fail(error); });
      child.once('exit', () => { clearTimeout(timer); fail(Error('Service exited before readiness')); });
      child.stdout.on('data', bytes => {
        buffer += bytes.toString(); const match = /CyperLink local API: (http:\/\/127\.0\.0\.1:\d+)\/v1\/projects/.exec(buffer);
        if (match) { clearTimeout(timer); done(match[1]); }
      });
    });
    (report.serviceProcessIds ??= []).push(child.pid); await save();
    return new CyperLinkServiceClient({ endpoint, token: serviceOptions.token, timeoutMs: 120_000 });
  }
  let client = await open();
  const project = await client.registerProject({ id: 'license', source: 'local' });
  assert.equal(project.genesis, report.genesisHash); report.api.push({ action: 'register', result: project }); await save();
  const runtime = async action => {
    const { stdout } = await execute('python3', ['scripts/runtime_local.py', action, '--environment', resolve(environment)], { cwd: REPO, timeout: 150_000, maxBuffer: 4 * 1024 * 1024 });
    const value = JSON.parse(stdout); report.runtime.push({ action, value }); await save(); return value;
  };
  const beforeRuntime = await runtime('inspect'); assert.equal(beforeRuntime.ready, true);
  async function journalFiles(path) {
    const names = (await readdir(path)).filter(name => /\.signed\.json$|\.attempt-|\.response-|\.simulation\.json$/.test(name));
    assert(names.some(name => name.endsWith('.signed.json')) && names.some(name => name.includes('.attempt-')), 'Expected actual signed wire and broadcast intent records');
    return Object.fromEntries(await Promise.all(names.map(async name => [name, sha(await readFile(resolve(path, name))).toString('hex')])));
  }
  async function paid(op, amount) {
    const session = await bindings.connectSession({ deployment: instance.descriptor, moduleRoot: instance.moduleRoot,
      endpoint: instance.endpoint, directory: op.approvalsDirectory, idl: instance.idl, proofCli: instance.proofCli });
    const signers = { administratorKeyfile: instance.payerKeyfile, ownerKeyfile: resolve(instance.assetDirectories.license, 'source-owner-signer.json') };
    op.plan = await session.prepare({ label: op.label, directory: op.directory, provisionedDirectory: instance.assetDirectories.license, amount,
      consumer: { kind: 'license', productHex32: sha(op.label).toString('hex'), expirySlot: String((await connection.getSlot('confirmed')) + 900) } }, signers);
    report.operations.push({ label: op.label, descriptor: op.plan.descriptor }); await save();
    const imported = await client.importOperation('license', { id: op.label, reference: op.label });
    assert.equal(imported.paymentCommitted, false);
    assert.deepEqual(await client.importOperation('license', { id: op.label, reference: op.label }), imported);
    const start = Date.now(); await session.stageQuery(op.plan, signers); const query = await session.submit(op.plan, 'query');
    assert.equal(query.delivery.status, 'landed');
    await callback(observer, op, 1, start, report, save);
    assert.equal((await client.observe('license', op.label)).observation.status, 'authorized');
    const d = op.plan.descriptor, template = validateOperation(d).template;
    op.keys = [template.source, template.destination, template.mint, d.quota, d.permit, d.effect, d.job].map(key => new PublicKey(key));
    const before = await snapshot(connection, op.keys, `${op.label}-before-payment`, report, save);
    op.ticket = await session.stageCommit(op.plan, signers);
    const result = await session.submit(op.plan, 'commit'); assert.equal(result.observation.status, 'committed');
    const tx = await connection.getTransaction(op.ticket.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    const entry = { signature: op.ticket.signature, slot: tx.slot, transaction: tx, role: 'commit', label: op.label };
    signedMessage(entry, web3, base58); report.transactions.push(entry);
    const after = await snapshot(connection, op.keys, `${op.label}-after-payment`, report, save);
    verifyPaidTransition(before, after, entry, op.plan);
    for (const address of [template.source, template.destination]) assert.notEqual(before.accounts.find(a => a.address === address).dataBase64, after.accounts.find(a => a.address === address).dataBase64);
    const recovered = await client.recover('license', op.label, 'commit');
    assert.equal(recovered.paymentCommitted, true); assert.equal(recovered.deliveries.commit.signature, op.ticket.signature);
    assert.equal(recovered.deliveries.commit.wireSha256, op.ticket.wireSha256);
    report.api.push({ action: 'recover', label: op.label, result: recovered }); await save();
    return after;
  }
  const first = operations[0];
  let settled;
  if (continuation) {
    const retainedSession = await bindings.connectSession({ deployment: instance.descriptor, moduleRoot: instance.moduleRoot,
      endpoint: instance.endpoint, directory: first.approvalsDirectory, idl: instance.idl, proofCli: instance.proofCli });
    first.plan = await retainedSession.load(first.directory); first.ticket = await retainedSession.discoverApproval(first.plan, 'commit');
    settled = report.accountSnapshots.find(value => value.label === 'before-restart-after-payment'); assert(settled);
    first.keys = settled.accounts.map(account => new PublicKey(account.address));
    assert.equal((await client.getOperation('license', first.label)).paymentCommitted, true);
  } else settled = await paid(first, 10);
  const journalBefore = await journalFiles(first.ticket.journalDirectory);
  report.recoveryJournalBefore = journalBefore; await save();
  await running.close(); running = undefined;
  const stopped = await runtime('stop'); assert.equal(stopped.ready, false);
  const resumed = await runtime('resume'); assert.equal(resumed.ready, true);
  assert.equal(resumed.genesis, beforeRuntime.genesis); assert.equal(resumed.runtime_id, beforeRuntime.runtime_id);
  client = await open();
  const retained = await client.getOperation('license', first.label); assert.equal(retained.paymentCommitted, true);
  const recovered = await client.recover('license', first.label, 'commit');
  assert.equal(recovered.observation.status, 'committed'); assert.equal(recovered.deliveries.commit.signature, first.ticket.signature);
  assert.equal(recovered.deliveries.commit.wireSha256, first.ticket.wireSha256);
  report.recoveryJournalAfter = await journalFiles(first.ticket.journalDirectory);
  assert.deepEqual(report.recoveryJournalAfter, journalBefore);
  unchanged(settled, await snapshot(connection, first.keys, 'retained-payment-after-runtime-restart', report, save));
  report.api.push({ action: 'recover-after-full-restart', result: recovered });
  report.checks.push('Same genesis/runtime identity and exact original signed payment after whole-stack restart', 'Recovery changed no tracked application account, signed wire, simulation or broadcast record'); await save();
  await paid(operations[1], 20);
  const quota = decodeQuota((await connection.getAccountInfo(observer.Q)).data); assert.equal(quota.version, 2n);
  report.finalState = { version: String(quota.version), counter: String(quota.counter), inferredRemainingObserverDisclosure: 20 };
  report.checks.push('Fresh post-restart native proofs, distributed callback and atomic payment/state/license effect', 'Shipped HTTP client and API preserve imported identity and paid facts across restart');
  report.passed = true; await save();
  console.log(JSON.stringify({ passed: true, results: resolve(directory, 'results.json'), callbacks: report.callbacks.length, payments: report.transactions.length }));
} catch (error) { report.error = error.stack; await save(); throw error; }
finally { if (running) await running.close(); }
