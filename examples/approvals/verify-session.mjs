#!/usr/bin/env node
/** Keyless local-chain evidence review. Never connects the signing adapter or sends a transaction. */
import assert from 'node:assert/strict';
import { readFile, readdir, realpath, stat, access } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { privateJson } from './store.mjs';
import { REPO, loadWeb3, loopbackEndpoint, writeNew } from '../../packages/local-client/src/runtime.mjs';
import { DurableTransactionSender } from '../../packages/local-client/src/durable-transaction.mjs';
import { validateOperationPlan, descriptorDigest } from '../../packages/local-client/src/operation-plan.mjs';
import { validateOperationTicket } from '../../packages/local-client/src/operation-ticket.mjs';
import { validatePreparedActionEvidence } from '../../packages/local-client/src/prepared-action.mjs';
import { OperationReader, LocalRpcTransport, validateOperation } from '../../packages/sdk/src/index.mjs';
const execute = promisify(execFile), sha = bytes => createHash('sha256').update(bytes).digest('hex');
const within = (path, parent) => resolve(path).startsWith(resolve(parent) + sep);
const readMethods = new Set(['getGenesisHash', 'getAccountInfo', 'getMultipleAccounts', 'getTransaction']);

export function readonlyFetch(endpoint, fetcher = globalThis.fetch) {
  const expected = loopbackEndpoint(endpoint);
  return async (url, options) => {
    assert.equal(loopbackEndpoint(url), expected, 'Unexpected review RPC endpoint');
    const body = JSON.parse(options.body), requests = Array.isArray(body) ? body : [body];
    assert(requests.length && requests.every(item => readMethods.has(item.method)), 'Verifier forbids non-read RPC methods');
    return fetcher(url, { ...options, redirect: 'error' });
  };
}
export function verifyLandedReceipt(saved, receipt) {
  if (receipt === null) return null;
  assert(Number.isSafeInteger(receipt.slot) && receipt.slot >= saved.record.minContextSlot);
  assert(receipt.meta && Object.hasOwn(receipt.meta, 'err'));
  assert.deepEqual(Buffer.from(receipt.transaction.message.serialize()), saved.message, 'Live receipt message differs from retained signed wire');
  assert.deepEqual(receipt.transaction.signatures, saved.signatures, 'Live receipt signatures differ from retained signed wire');
  const addresses = Object.fromEntries(['writable', 'readonly'].map(role => [role, (receipt.meta.loadedAddresses?.[role] ?? []).map(key => key.toBase58())]));
  assert.deepEqual(addresses, saved.record.loadedAddresses, 'Live receipt lookup resolution differs');
  return { slot: receipt.slot, succeeded: receipt.meta.err === null, feeLamports: receipt.meta.fee,
    landedCU: receipt.meta.computeUnitsConsumed ?? 0 };
}
export function publicObservation(value) {
  assert(['unobserved', 'queued', 'authorized', 'committed', 'denied', 'stale', 'expired', 'cancelled', 'invalidated'].includes(value.status));
  assert(Number.isSafeInteger(value.slot) && value.slot >= 0);
  if (value.commitment !== undefined) assert(['confirmed', 'finalized'].includes(value.commitment));
  if (value.licenseActive !== undefined) assert.equal(typeof value.licenseActive, 'boolean');
  for (const key of ['quotaVersion', 'licenseExpirySlot']) if (value[key] !== undefined) assert(typeof value[key] === 'string' && /^(0|[1-9][0-9]*)$/.test(value[key]));
  return Object.fromEntries(['status', 'slot', 'commitment', 'quotaVersion', 'licenseActive', 'licenseExpirySlot']
    .filter(key => Object.hasOwn(value, key)).map(key => [key, value[key]]));
}
export function sessionIntentHash(state) {
  return sha(JSON.stringify({ schema: state.schema, id: state.id, genesis: state.genesis, bootstrap: state.bootstrap,
    operations: state.operations.map(operation => Object.fromEntries(
      ['id', 'requestId', 'label', 'consumer', 'amount', 'planHash', 'tickets', 'inFlight', 'interrupted']
        .filter(key => Object.hasOwn(operation, key)).map(key => [key, operation[key]]))) }));
}
function costs(value) {
  assert(value && typeof value === 'object');
  return Object.fromEntries(Object.entries(value).map(([category, group]) => {
    assert(/^[a-z-]+$/.test(category));
    return [category, Object.fromEntries(['transactions', 'landedCU', 'feeLamports'].map(key => {
      assert(Number.isSafeInteger(group[key]) && group[key] >= 0); return [key, group[key]];
    }))];
  }));
}
async function existingDirectory(path) {
  const full = resolve(path); assert(within(full, resolve(REPO, '.local')) && await realpath(full) === full);
  const info = await stat(full); assert(info.isDirectory() && info.uid === process.getuid() && !(info.mode & 0o077)); return full;
}
export async function verifySession({ bootstrapPath, sessionPath }) {
  const bootstrap = await privateJson(bootstrapPath), directory = await existingDirectory(sessionPath);
  assert(bootstrap.schema === 1 && bootstrap.passed === true && bootstrap.qualification === 'bootstrap-only-not-purchase');
  const statePath = resolve(directory, 'state.json'), state = await privateJson(statePath), stateHash = sha(await readFile(statePath));
  assert.deepEqual(JSON.parse(await readFile(statePath)), state, 'Session changed while loading');
  assert.equal(state.schema, 1); assert(/^[a-f0-9-]{36}$/.test(state.id)); assert.equal(state.genesis, bootstrap.genesisHash);
  assert.equal(state.bootstrap, resolve(bootstrap.bootstrapDirectory));
  assert(Array.isArray(state.operations) && state.operations.length > 0, 'No interactive operations to review');
  const endpoint = loopbackEndpoint(bootstrap.endpoint), web3 = await loadWeb3(bootstrap.moduleRoot);
  const fetcher = readonlyFetch(endpoint), connection = new web3.Connection(endpoint, { commitment: 'confirmed', fetch: fetcher, disableRetryOnRateLimit: true });
  assert.equal(await connection.getGenesisHash(), bootstrap.genesisHash, 'Session belongs to a different ledger');
  const preparation = JSON.parse(await readFile(bootstrap.preparation));
  assert.equal(preparation.deployments.length, 10); assert.equal(bootstrap.loadedPrograms.length, 10);
  assert.equal(new Set(preparation.deployments.map(item => item.address)).size, 10);
  const loadedPrograms = [];
  for (const deployment of preparation.deployments) {
    const expected = bootstrap.loadedPrograms.find(item => item.program === deployment.address); assert(expected?.matched);
    const { stdout } = await execute('python3', [resolve(REPO, 'scripts/verify_loaded_program.py'), '--program-id', deployment.address,
      '--elf', deployment.elf, '--rpc', endpoint], { maxBuffer: 1024 * 1024 });
    const actual = JSON.parse(stdout), original = JSON.parse(await readFile(expected.evidenceFile));
    assert(actual.matched && actual.genesis_hash === bootstrap.genesisHash && original.matched && original.genesis_hash === bootstrap.genesisHash);
    assert.equal(actual.elf_sha256, expected.elfSha256); assert.equal(actual.loaded_elf_sha256, expected.loadedElfSha256);
    assert.equal(original.elf_sha256, actual.elf_sha256); assert.equal(original.program, deployment.address);
    loadedPrograms.push({ program: deployment.address, elfSha256: actual.elf_sha256, loadedElfSha256: actual.loaded_elf_sha256, slot: actual.rpc_slot });
  }
  const reader = new OperationReader(new LocalRpcTransport(endpoint, { commitment: 'confirmed', fetch: fetcher }));
  const operations = [], byJob = new Map(), bySignature = new Map(), operationCosts = {};
  for (const operation of state.operations) {
    assert(/^[a-f0-9-]{36}$/.test(operation.id), 'Unsafe operation identifier');
    assert(operation.planHash, 'Incomplete preparation requires separate inspection');
    const planPath = resolve(directory, `operation-${operation.id}`, 'operation-plan.json');
    const plan = validateOperationPlan(await privateJson(planPath)), planHash = sha(await readFile(planPath));
    assert.deepEqual(JSON.parse(await readFile(planPath)), plan, 'Plan changed while loading');
    assert.equal(planHash, operation.planHash, 'Retained plan changed'); assert.equal(plan.genesisHash, bootstrap.genesisHash);
    assert.equal(plan.descriptor.consumerKind, operation.consumer);
    const asset = await privateJson(resolve(bootstrap.assetDirectories[operation.consumer], 'provisioned.json'));
    const { template } = validateOperation(plan.descriptor);
    assert.equal(plan.descriptor.owner, asset.source_owner);
    for (const field of ['source', 'destination', 'mint']) assert.equal(template[field], asset.accounts[field].address);
    assert(!byJob.has(plan.descriptor.job), 'Repeated operation identity');
    byJob.set(plan.descriptor.job, { plan, planHash });
    const tickets = [];
    for (const [role, ticket] of Object.entries(operation.tickets ?? {})) {
      assert(['query', 'commit'].includes(role) && role === ticket.role);
      assert(within(ticket.journalDirectory, directory), 'Ticket journal outside session');
      assert.equal(ticket.descriptorSha256, descriptorDigest(plan.descriptor));
      const sender = await DurableTransactionSender.open({ web3, connection, endpoint, directory: ticket.journalDirectory });
      const saved = await sender.read(ticket); // Read only: recover() may persist a receipt and is deliberately not called.
      const binding = await validateOperationTicket(plan, saved.record, web3, connection);
      const receipt = await connection.getTransaction(ticket.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      const summary = verifyLandedReceipt(saved, receipt);
      assert(!bySignature.has(ticket.signature), 'Signed ticket reused by multiple operations');
      bySignature.set(ticket.signature, { plan, planHash, ticket, saved, binding, summary });
      reader.minimumSlot = Math.max(reader.minimumSlot ?? 0, plan.contextSlot, summary?.slot ?? 0);
      const publicTicket = { role, signature: ticket.signature, wireSha256: ticket.wireSha256,
        verifiedRequiredSigners: saved.tx.message.staticAccountKeys.slice(0, saved.tx.message.header.numRequiredSignatures).map(key => key.toBase58()),
        broadcasts: saved.attempts, receipt: summary, ...(binding.preparedAction ? { preparedAction: {
          address: binding.preparedAction.address, slot: binding.preparedAction.slot, sha256: binding.preparedAction.sha256 } } : {}) };
      tickets.push(publicTicket);
      if (summary) {
        const group = operationCosts[role] ??= { transactions: 0, landedCU: 0, feeLamports: 0 };
        for (const [key, value] of Object.entries({ transactions: 1, landedCU: summary.landedCU, feeLamports: summary.feeLamports })) {
          assert(Number.isSafeInteger(value) && value >= 0); group[key] += value;
        }
      }
    }
    reader.minimumSlot = Math.max(reader.minimumSlot ?? 0, plan.contextSlot);
    const observation = await reader.observe(plan.descriptor);
    if (observation.status === 'committed') {
      for (const role of ['query', 'commit']) assert(tickets.some(item => item.role === role && item.receipt?.succeeded), 'Committed effect requires both exact successful signed receipts');
    }
    if (operation.observation?.status === 'committed') assert.equal(observation.status, 'committed', 'Cached paid claim not supported by chain');
    operations.push({ id: operation.id, consumer: operation.consumer, planSha256: planHash, descriptorSha256: descriptorDigest(plan.descriptor),
      owner: plan.descriptor.owner, job: plan.descriptor.job, permit: plan.descriptor.permit, effect: plan.descriptor.effect,
      observation: publicObservation(observation), tickets });
  }
  const workers = [], names = await readdir(directory), workerTickets = new Map();
  for (const name of names.filter(item => /^worker-[a-f0-9-]+-ticket\.json$/.test(item))) {
    const path = resolve(directory, name), ticket = await privateJson(path), raw = await readFile(path);
    assert.deepEqual(JSON.parse(raw), ticket); workerTickets.set(sha(raw), { ticket, bytes: raw.length });
  }
  for (const name of names) {
    if (!/^worker-[a-f0-9-]+-result\.json$/.test(name)) continue;
    const worker = await privateJson(resolve(directory, name));
    assert(worker.passed === true && worker.generatesKeysProofsOrOperationIdentity === false && worker.createsNewSignedTransaction === false);
    assert(Number.isSafeInteger(worker.processId) && worker.processId > 0);
    assert(['recover-ticket', 'submit-ticket'].includes(worker.action));
    assert.equal(worker.genesisHash, bootstrap.genesisHash);
    const workerTicket = workerTickets.get(worker.retainedTicket?.sha256); assert(workerTicket, 'Worker retained ticket file missing');
    assert.equal(worker.retainedTicket.bytes, workerTicket.bytes);
    const retained = bySignature.get(worker.delivery?.signature); assert(retained, 'Worker ticket not retained in session');
    assert.deepEqual(workerTicket.ticket, retained.ticket);
    assert.equal(worker.retainedPlan.sha256, retained.planHash);
    assert.equal(worker.delivery.descriptorSha256, descriptorDigest(retained.plan.descriptor));
    assert.equal(worker.delivery.semanticBinding.instructionSha256, retained.binding.instructionSha256);
    assert.equal(worker.delivery.semanticBinding.wireSha256, retained.ticket.wireSha256);
    assert.equal(worker.delivery.wireSha256, retained.ticket.wireSha256);
    assert.equal(worker.delivery.role, retained.ticket.role);
    assert(['prepared', 'pending', 'landed', 'failed', 'observed-without-receipt', 'expired-unresolved', 'simulation-required', 'simulation-rejected'].includes(worker.delivery.status));
    for (const key of ['job', 'computation', 'permit', 'owner', 'quota', 'effect']) assert.equal(worker.identity[key], retained.plan.descriptor[key]);
    if (retained.ticket.role === 'query') validatePreparedActionEvidence(retained.plan, worker.delivery.semanticBinding.preparedAction);
    assert(worker.observation.slot >= retained.plan.contextSlot);
    workers.push({ artifactSha256: sha(await readFile(resolve(directory, name))), processId: worker.processId, action: worker.action, signature: worker.delivery.signature,
      wireSha256: worker.delivery.wireSha256, deliveryStatus: worker.delivery.status, observation: publicObservation(worker.observation) });
  }
  assert.equal(await connection.getGenesisHash(), bootstrap.genesisHash, 'Validator changed during review');
  assert.equal(sessionIntentHash(await privateJson(statePath)), sessionIntentHash(state), 'Session intent changed during review; repeat once idle');
  return { schema: 1, passed: true, evidenceLevel: 'keyless-read-only-local-validator-session-review', genesisHash: bootstrap.genesisHash,
    sessionId: state.id, privateStateSha256: stateHash, retainedIntentSha256: sessionIntentHash(state), loadedPrograms, operations, recoveryWorkers: workers,
    counts: { operations: operations.length, committed: operations.filter(item => item.observation.status === 'committed').length,
      signedTickets: bySignature.size, recoveryWorkers: workers.length },
    validatorCosts: { verifiedOperationReceipts: costs(operationCosts), archivedBootstrapReported: costs(bootstrap.validatorCostByCategory) },
    limitations: ['passed means these checks passed; paid effects are only operations observed committed. Cached UI observations may refresh during review; retained intent/tickets must remain unchanged.',
      'No keys, witnesses, amounts, private session events or signed wires are exported; local operation state is read for retained intent.',
      'Operation signatures/messages, current immutable action, loaded ELF and SDK effect observations are checked; upstream native proofs and runtime BLS are not independently re-executed.',
      'Bootstrap cost totals are retained reports. Preparation and callback costs after bootstrap are excluded from operation receipt totals; distributed worker resource costs are unmeasured.',
      'Worker process IDs and deliberate response-loss classifications are retained test evidence, not operating-system attestations. Confirmed RPC responses are not historical state proofs.'] };
}
export async function main(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(['--bootstrap', '--session', '--out'].includes(args[i]) && args[i + 1] && !options[args[i]], 'Expected --bootstrap --session --out'); options[args[i]] = args[i + 1];
  }
  assert(options['--bootstrap'] && options['--session'] && options['--out']);
  const output = resolve(options['--out']); await existingDirectory(dirname(output));
  try { await access(output); throw Error('Output already exists'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const report = await verifySession({ bootstrapPath: options['--bootstrap'], sessionPath: options['--session'] });
  await writeNew(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, output, counts: report.counts }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
