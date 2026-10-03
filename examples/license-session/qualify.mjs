#!/usr/bin/env node
/** Real-local process crash qualification; synthetic observer amounts are public here. */
import assert from 'node:assert/strict';
import { readFile, access, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { createPrivateRun, REPO } from '../../packages/local-client/src/runtime.mjs';
import { validateOperation, decodeQuota } from '../../packages/policy-client/src/sdk.mjs';
import { descriptorDigest } from '../../packages/policy-client/src/operation-plan.mjs';
import { DurableTransactionSender } from '../../packages/local-client/src/durable-transaction.mjs';
import { validateOperationTicket } from '../../packages/policy-client/src/operation-ticket.mjs';
import { json, writeJson, sha, snapshot, unchanged, callback } from '../policies/qualification/evidence.mjs';
import { verifyPaidTransition, signedMessage } from '../policies/qualification/archive.mjs';
const execute = promisify(execFile), [instancePath, output] = process.argv.slice(2);
assert(instancePath && output, 'Usage: qualify.mjs INSTANCE NEW_OUTPUT');
const instance = await json(instancePath), directory = await createPrivateRun(output);
const results = { schema: 1, passed: false, classification: 'real-local-session-process-crash-qualification', instancePath: resolve(instancePath),
  deployment: instance.descriptor, genesisHash: instance.descriptor.genesisHash, observerDisclosures: { remaining: 50, purchase_cap: 30, purchases: [10, 20] },
  appInvocations: [], crashes: [], callbacks: [], transactions: [], accountSnapshots: [], loadedPrograms: [], operations: [], checks: [] };
const save = () => writeJson(resolve(directory, 'results.json'), results);
await save();
try {
  const bindings = await import(pathToFileURL(resolve(instance.releaseDirectory, '../../bindings.mjs')));
  const observer = await bindings.connect({ ...instance, deployment: instance.descriptor, directory: await createPrivateRun(resolve(directory, 'observer')) });
  const { connection, web3 } = observer.session, { PublicKey } = web3;
  await observer.assertDeploymentState();
  const require = createRequire(resolve(instance.moduleRoot, 'package.json')), base58 = require('@anchor-lang/core').utils.bytes.bs58;
  const deployed = await json(instance.results);
  for (const [index, p] of deployed.loadedPrograms.entries()) {
    const path = resolve(directory, `loaded-${index}.json`);
    await execute('python3', ['scripts/verify_loaded_program.py', '--program-id', p.program, '--elf', p.local_elf_path, '--rpc', instance.endpoint, '--output', path]);
    const report = await json(path); assert(report.matched); assert.equal(report.genesis_hash, results.genesisHash); results.loadedPrograms.push(report);
  }
  assert.equal(results.loadedPrograms.length, 10);
  const initial = decodeQuota((await connection.getAccountInfo(observer.Q)).data); assert.equal(initial.version, 0n);
  results.initialState = { version: String(initial.version), counter: String(initial.counter) }; await save();
  async function app(command, op, extra = [], crashPoint) {
    const args = ['examples/license-session/app.mjs', command, '--instance', resolve(instancePath), '--operation', op.directory, ...extra];
    if (['prepare', 'approve-query', 'approve-payment'].includes(command)) args.push('--admin-keyfile', instance.payerKeyfile, '--owner-keyfile', op.owner);
    const id = results.appInvocations.length, marker = resolve(directory, `crash-${id}.json`), role = command === 'approve-query' ? 'query' : 'commit';
    let stdout = '', stderr = '', code = 0, signal = null;
    try { ({ stdout, stderr } = await execute(process.execPath, args, { cwd: REPO, maxBuffer: 8 * 1024 * 1024,
      env: { ...process.env, ...(crashPoint ? { CYPERLINK_TEST_CRASH_POINT: crashPoint, CYPERLINK_TEST_CRASH_ROLE: role,
        CYPERLINK_TEST_CRASH_MARKER: marker, NODE_OPTIONS: `--import=${pathToFileURL(resolve(REPO, 'examples/license-session/crash.mjs'))}` } : {}) } })); }
    catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; code = error.code; signal = error.signal; }
    const entry = { id, command, label: op.label, args, code, signal, stdout, stderr, ...(crashPoint ? { crashPoint, marker } : {}) };
    results.appInvocations.push(entry); await save();
    if (crashPoint) { assert.equal(signal, 'SIGKILL', stderr); return json(marker); }
    assert.equal(code, 0, stderr); return JSON.parse(stdout.trim().split('\n').at(-1));
  }
  async function prepare(label, amount) {
    const op = { label, directory: resolve(directory, label), owner: resolve(instance.assetDirectories.license, 'source-owner-signer.json') };
    await app('prepare', op, ['--label', label, '--amount', String(amount), '--product', sha(label).toString('hex'), '--expiry-slot', String((await connection.getSlot()) + 900)]);
    op.plan = await json(resolve(op.directory, 'operation-plan.json')); results.operations.push({ label, planPath: resolve(op.directory, 'operation-plan.json'), descriptor: op.plan.descriptor }); await save(); return op;
  }
  function tracked(op) {
    const d = op.plan.descriptor, t = validateOperation(d).template;
    return [t.source, t.destination, t.mint, ...op.plan.binding.proofAddresses, d.quota, d.permit, d.effect, d.job, d.computation, op.plan.action].map(x => new PublicKey(x));
  }
  const snap = (op, name) => snapshot(connection, tracked(op), name, results, save);
  async function boundary(approval) {
    const approvalEntries = await readdir(approval), journal = resolve(approval, 'signing/transaction-journal'), journalEntries = await readdir(journal);
    const files = {};
    for (const name of journalEntries) files[name] = sha(await readFile(resolve(journal, name))).toString('hex');
    const ticket = approvalEntries.includes('ticket.json') ? await json(resolve(approval, 'ticket.json')) : null;
    const simulationNames = journalEntries.filter(name => name.endsWith('.simulation.json'));
    return { approvalEntries, journalEntries, fileHashes: files, ticket, simulations: Object.fromEntries(await Promise.all(simulationNames.map(async name => [name, await json(resolve(journal, name))]))),
      broadcasts: journalEntries.filter(name => name.includes('.broadcast-') && name.endsWith('.intent.json')) };
  }
  async function crashRecover(op, role, point) {
    const before = await snap(op, `${op.label}-${role}-before-crash`);
    const marker = await app(role === 'query' ? 'approve-query' : 'approve-payment', op, ['--submit', 'no'], point);
    const approval = resolve(`${op.directory}-approvals`, `${descriptorDigest(op.plan.descriptor)}-${role}`);
    await assert.rejects(access(resolve(approval, 'ticket.json')), { code: 'ENOENT' });
    if (point === 'after-wire') await assert.rejects(access(resolve(marker.ticket.journalDirectory, `${marker.ticket.signature}.simulation.json`)), { code: 'ENOENT' });
    const beforeRecovery = await boundary(approval);
    const recovered = await app('recover', op, ['--role', role]);
    const afterReadonlyRecovery = await boundary(approval);
    assert.equal(recovered.ticket.signature, marker.ticket.signature); assert.equal(recovered.ticket.wireSha256, marker.ticket.wireSha256);
    assert.equal(recovered.deliveryStatus, point === 'after-wire' ? 'simulation-required' : 'prepared');
    const sender = await DurableTransactionSender.open({ web3, connection, endpoint: instance.endpoint, directory: recovered.ticket.journalDirectory });
    const saved = await sender.read(recovered.ticket); assert.equal(saved.attempts, 0);
    await validateOperationTicket(op.plan, saved.record, web3, connection);
    unchanged(before, await snap(op, `${op.label}-${role}-after-readonly-recovery`));
    const delivered = await app('recover', op, ['--role', role, '--submit', 'yes']);
    assert.equal(delivered.deliveryStatus, 'landed'); assert.equal(delivered.ticket.signature, marker.ticket.signature);
    const after = await sender.read(recovered.ticket); assert(saved.wire.equals(after.wire)); assert.equal(after.attempts, 1);
    const receipt = await connection.getTransaction(marker.ticket.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    const entry = { signature: marker.ticket.signature, slot: receipt.slot, transaction: receipt, role, label: op.label };
    signedMessage(entry, web3, base58); results.transactions.push(entry);
    results.crashes.push({ label: op.label, role, point, marker, recovered, delivered, approval, beforeRecovery, afterReadonlyRecovery, signedBytesUnchanged: true, readonlyAccountsUnchanged: true }); await save();
    return { before, entry };
  }
  for (const [label, amount, queryPoint, commitPoint] of [['first', 10, 'after-wire', 'after-simulation'], ['second', 20, 'after-simulation', 'after-wire']]) {
    const op = await prepare(label, amount), started = Date.now();
    await crashRecover(op, 'query', queryPoint);
    const cb = await callback(observer, op, 1, started, results, save); assert.equal(cb.result.output.field1, true);
    const paid = await crashRecover(op, 'commit', commitPoint), after = await snap(op, `${label}-paid`);
    verifyPaidTransition(paid.before, after, paid.entry, op.plan);
    const t = validateOperation(op.plan.descriptor).template;
    for (const address of [t.source, t.destination]) assert.notEqual(paid.before.accounts.find(a => a.address === address).dataBase64, after.accounts.find(a => a.address === address).dataBase64);
    assert.equal((await app('observe', op)).paymentCommitted, true);
    const repeated = await app('recover', op, ['--role', 'commit']); assert.equal(repeated.ticket.signature, paid.entry.signature); assert.equal(repeated.paymentCommitted, true);
    results.checks.push(`${label}: authenticated callback, native ciphertext changes, full successor state and paid license, exact recovery`); await save();
  }
  const interrupted = await prepare('before-wire', 1), before = await snap(interrupted, 'before-wire-before');
  const beforeWireMarker = await app('approve-query', interrupted, ['--submit', 'no'], 'before-wire');
  const interruptedApproval = resolve(`${interrupted.directory}-approvals`, `${descriptorDigest(interrupted.plan.descriptor)}-query`);
  results.interrupted = { marker: beforeWireMarker, beforeRefusals: await boundary(interruptedApproval), refusals: [] };
  for (const command of ['recover', 'approve-query']) {
    const extra = command === 'recover' ? ['--role', 'query'] : ['--submit', 'no', '--admin-keyfile', instance.payerKeyfile, '--owner-keyfile', interrupted.owner];
    let failure; try { await execute(process.execPath, ['examples/license-session/app.mjs', command, '--instance', resolve(instancePath), '--operation', interrupted.directory, ...extra]); } catch (error) { failure = error; }
    assert(failure); assert.match(failure.stderr, /APPROVAL_INTERRUPTED_BEFORE_SIGNED_RECORD/);
    results.interrupted.refusals.push({command, args: extra, code: failure.code, stderr: failure.stderr});
    results.checks.push(`${command}: attempt interrupted before signed-record persistence refuses automatic restaging`);
  }
  results.interrupted.afterRefusals = await boundary(interruptedApproval);
  unchanged(before, await snap(interrupted, 'before-wire-after-refusals'));
  results.circuitArtifacts = {};
  for (const name of ['runtime_policy_init', 'runtime_policy_evaluate']) results.circuitArtifacts[name] = await json(resolve(instancePath, '..', `${name}-uploaded-evidence.json`));
  const state = decodeQuota((await connection.getAccountInfo(observer.Q)).data); assert.equal(state.version, 2n); assert.equal(state.counter, initial.counter + 2n);
  results.finalState = { version: String(state.version), counter: String(state.counter), inferredRemainingObserverDisclosure: 20 };
  results.passed = true; await save(); console.log(JSON.stringify({ passed: true, results: resolve(directory, 'results.json'), crashes: results.crashes.length }));
} catch (error) { results.error = error.stack; await save(); throw error; }
