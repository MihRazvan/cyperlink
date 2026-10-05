#!/usr/bin/env node
/** Separate-process, keyless local HTTP recovery. Never supplies signer options. */
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fork } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { validateOperation } from '../../packages/policy-client/src/sdk.mjs';
import { snapshot } from '../../examples/policies/qualification/evidence.mjs';
const [instanceArg, workspaceArg, outputArg] = process.argv.slice(2);
assert(instanceArg && workspaceArg && outputArg, 'Usage: qualify-recovery.mjs INSTANCE STOPPED_WORKSPACE NEW_OUTPUT');
const instancePath = resolve(instanceArg), directory = resolve(workspaceArg), output = resolve(outputArg);
assert(output.startsWith(resolve('.local') + '/') && directory.startsWith(resolve('.local') + '/'));
await mkdir(output, { mode: 0o700 });
const json = async path => JSON.parse(await readFile(path));
const instance = await json(instancePath), retained = await json(resolve(directory, 'console.json'));
const op = retained.operations.findLast(o => o.consumer.kind === 'license' && o.paymentCommitted);
assert(op && op.deliveries.commit.status === 'landed');
const plan = await json(resolve(directory, 'operations', op.id, 'operation-plan.json'));
const req = createRequire(resolve(instance.moduleRoot, 'package.json')), web3 = req('@solana/web3.js');
const connection = new web3.Connection(instance.endpoint, 'confirmed'), d = plan.descriptor, t = validateOperation(d).template;
const evidence = { schema: 1, passed: false, classification: 'separate-process-keyless-local-console-http-recovery', instancePath,
  operation: { id: op.id, planHash: op.planHash, delivery: op.deliveries.commit }, stages: [], accountSnapshots: [] };
const save = () => writeFile(resolve(output, 'recovery.json'), JSON.stringify(evidence, null, 2) + '\n', { mode: 0o600 });
async function immutableFiles(path, result = {}) {
  for (const entry of await readdir(path, { withFileTypes: true })) {
    const name = resolve(path, entry.name);
    if (entry.isDirectory()) await immutableFiles(name, result);
    else if (/\.(signed|attempt-\d+|simulation)\.json$/.test(entry.name)) result[name] = createHash('sha256').update(await readFile(name)).digest('hex');
  }
  return result;
}
const snap = label => snapshot(connection, [d.job, d.permit, d.quota, d.effect, t.source, t.destination].map(k => new web3.PublicKey(k)), label, evidence, save);
const worker = fork(new URL('./test/recovery-process.mjs', import.meta.url), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
let next = 0;
const pending = new Map();
worker.on('message', m => { const item = pending.get(m.id); if (item) { pending.delete(m.id); clearTimeout(item.timer); m.error ? item.reject(Error(m.error)) : item.resolve(m); } });
const call = message => new Promise((resolve, reject) => { const id = ++next, timer = setTimeout(() => { pending.delete(id); reject(Error('Worker timeout')); }, 60_000); pending.set(id, { resolve, reject, timer }); worker.send({ ...message, id }); });
let url, cookie;
const headers = () => ({ Cookie: cookie, 'Content-Type': 'application/json', 'X-Cyperlink-Client': 'console', Origin: url });
async function state() { const r = await fetch(`${url}/api/state`, { headers: headers() }); assert.equal(r.status, 200); return r.json(); }
async function recover(label) {
  const r = await fetch(`${url}/api/operations/${op.id}/recover-payment`, { method: 'POST', headers: headers(), body: JSON.stringify({ consent: 'recover-payment', planHash: op.planHash }) });
  assert.equal(r.status, 202, await r.text());
  for (let i = 0; i < 120; i++) {
    const s = await state(), current = s.operations.find(o => o.id === op.id);
    if (!current.busy) {
      assert.equal(current.planHash, op.planHash); assert.equal(current.paymentCommitted, true);
      assert(!s.project.signingEnabled && !s.project.administratorConfigured && s.project.sources.every(source => !source.canSign));
      assert(!current.actions.includes('approve-payment') && !current.actions.includes('submit-payment'));
      evidence.stages.push({ label, operation: current }); await save(); return current;
    }
    await new Promise(done => setTimeout(done, 250));
  }
  throw Error('Recovery did not finish');
}
try {
  evidence.immutableBefore = await immutableFiles(resolve(directory, 'approvals'));
  const before = await snap('before-keyless-process');
  const started = await call({ command: 'start', instancePath, directory, signature: op.deliveries.commit.signature });
  url = started.url; evidence.processId = started.processId;
  assert.notEqual(started.processId, process.pid);
  const home = await fetch(url); cookie = home.headers.get('set-cookie').split(';')[0];
  const initial = await recover('keyless-original-receipt'); assert.equal(initial.error, null); assert.equal(initial.deliveries.commit.status, 'landed');
  await call({ command: 'fault', mode: 'receipt' });
  const unavailable = await recover('receipt-transport-unavailable');
  assert.equal(unavailable.error, null);
  assert.equal(unavailable.observation.status, 'committed'); assert.equal(unavailable.deliveries.commit.canBroadcast, false);
  assert.notEqual(unavailable.deliveries.commit.status, 'landed');
  await call({ command: 'fault', mode: 'accounts' });
  const unresolved = await recover('receipt-and-account-transport-unavailable');
  assert(unresolved.observation === null || unresolved.observation.status === 'unresolved');
  await call({ command: 'fault', mode: 'none' });
  const restored = await recover('original-receipt-restored'); assert.equal(restored.deliveries.commit.status, 'landed'); assert.equal(restored.observation.status, 'committed');
  for (const stage of evidence.stages) {
    assert.equal(stage.operation.deliveries.commit.signature, op.deliveries.commit.signature);
    assert.equal(stage.operation.deliveries.commit.wireSha256, op.deliveries.commit.wireSha256);
  }
  evidence.events = (await call({ command: 'events' })).events;
  assert(evidence.events.some(e => e.blocked && e.method === 'getTransaction'));
  assert(evidence.events.some(e => e.blocked && e.method === 'getMultipleAccounts'));
  assert(!evidence.events.some(e => ['sendTransaction', 'simulateTransaction'].includes(e.method)));
  const after = await snap('after-keyless-process'); assert.deepEqual(after.accounts, before.accounts);
  evidence.immutableAfter = await immutableFiles(resolve(directory, 'approvals')); assert.deepEqual(evidence.immutableAfter, evidence.immutableBefore);
  evidence.passed = true; await save(); console.log('KEYLESS RECOVERY PASSED');
} catch (error) { evidence.failure = error.message; await save(); console.error(error.stack); process.exitCode = 1; }
finally {
  evidence.events ??= (await call({ command: 'events' }).catch(() => ({ events: [] }))).events;
  await save(); await call({ command: 'close' }).catch(() => worker.kill('SIGTERM'));
}
