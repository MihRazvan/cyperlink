#!/usr/bin/env node
/** Independent offline archive checks. Reads no signer files and performs no RPC. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { signedMessage, decodeSnapshot, verifyPaidTransition, checkState } from '../policies/qualification/archive.mjs';
import { descriptorDigest, validateOperationPlan } from '../../packages/policy-client/src/operation-plan.mjs';
import { validateOperationTicket } from '../../packages/policy-client/src/operation-ticket.mjs';
import { validateOperation } from '../../packages/policy-client/src/sdk.mjs';
import { decodeJob } from '../../packages/policy-client/src/codec.mjs';
import { DurableTransactionSender } from '../../packages/local-client/src/durable-transaction.mjs';
import { verifyUploadedCircuit } from '../../packages/policy-cli/src/circuit-evidence.mjs';
import { TOKEN_PROGRAM } from '../../packages/local-client/src/runtime.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RUNTIME = 'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ';
const json = async path => JSON.parse(await readFile(path));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const canonicalTicket = ticket => Object.fromEntries(['schemaVersion', 'journalDirectory', 'genesisHash', 'signature', 'wireSha256', 'role', 'descriptorSha256'].map(key => [key, ticket[key]]));
const business = q => Buffer.concat([q.subarray(0, 88), q.subarray(96)]);

function boundary(value, ticket, simulated, hasTicket) {
  assert(value, 'Missing historical approval/journal directory capture');
  assert(Array.isArray(value.approvalEntries) && Array.isArray(value.journalEntries));
  assert.equal(new Set(value.approvalEntries).size, value.approvalEntries.length);
  assert.equal(new Set(value.journalEntries).size, value.journalEntries.length);
  assert(value.approvalEntries.includes('intent.json'));
  assert.equal(value.approvalEntries.includes('ticket.json'), hasTicket, 'Historical ticket presence differs');
  assert.deepEqual(value.ticket, hasTicket ? canonicalTicket(ticket) : null);
  assert(value.journalEntries.includes('journal.json'));
  assert(value.journalEntries.includes(`${ticket.signature}.signed.json`));
  assert.equal(value.journalEntries.some(name => name.startsWith(`${ticket.signature}.attempt-`)), false, 'Read-only boundary has broadcast intents');
  assert.equal(value.journalEntries.includes(`${ticket.signature}.simulation.json`), simulated);
  const simulation = value.simulations[`${ticket.signature}.simulation.json`] ?? null;
  assert.equal(simulation === null, !simulated);
  if (simulated) {
    assert.equal(simulation.signature, ticket.signature); assert.equal(simulation.wireSha256, ticket.wireSha256);
    assert.equal(simulation.simulation.value.err, null);
  }
  assert.deepEqual(Object.keys(value.fileHashes).sort(), [...value.journalEntries].sort());
  for (const hash of Object.values(value.fileHashes)) assert(/^[0-9a-f]{64}$/.test(hash));
}

export async function reviewSessionArchive({ resultsPath, instancePath, resultsOverride }) {
  const input = resolve(resultsPath), raw = await readFile(input), r = resultsOverride ?? JSON.parse(raw);
  assert.equal(r.passed, true); assert.equal(r.classification, 'real-local-session-process-crash-qualification');
  assert.equal(resolve(r.instancePath), resolve(instancePath));
  const instance = await json(instancePath);
  assert.deepEqual(instance.descriptor, r.deployment); assert.equal(r.genesisHash, instance.descriptor.genesisHash);
  const req = createRequire(resolve(instance.moduleRoot, 'package.json'));
  const web3 = req('@solana/web3.js'), anchor = req('@anchor-lang/core'), ar = req('@arcium-hq/client');
  const { convertIdlToCamelCase } = req('@anchor-lang/core/dist/cjs/idl.js');
  const b58m = req('bs58'), b58 = b58m.default ?? b58m;
  const coder = new anchor.BorshInstructionCoder(await json(instance.idl));
  const seen = new Map(); let signatures = 0;
  assert.equal(r.transactions.length, 4); assert.equal(r.callbacks.length, 2);
  for (const entry of [...r.transactions, ...r.callbacks]) {
    assert(!seen.has(entry.signature), 'Duplicate archived transaction');
    const decoded = signedMessage(entry, web3, b58); signatures += decoded.signatures;
    assert.equal(entry.transaction.meta.err, null); seen.set(entry.signature, { entry, ...decoded });
  }
  const snaps = new Map(r.accountSnapshots.map(snapshot => [snapshot.label, snapshot]));
  assert.equal(snaps.size, r.accountSnapshots.length);
  const snapshot = label => { assert(snaps.has(label), `Missing ${label} snapshot`); return snaps.get(label); };
  const plans = new Map();
  for (const op of r.operations) {
    assert(!plans.has(op.label)); const plan = validateOperationPlan(await json(op.planPath));
    assert.equal(plan.genesisHash, r.genesisHash); assert.deepEqual(plan.descriptor, op.descriptor);
    assert.deepEqual(plan.descriptor.deployment, r.deployment); plans.set(op.label, { plan, ...op });
  }
  assert.deepEqual([...plans.keys()].sort(), ['before-wire', 'first', 'second']);
  const expectedCrashes = ['first:query:after-wire', 'first:commit:after-simulation', 'second:query:after-simulation', 'second:commit:after-wire'];
  assert.deepEqual(r.crashes.map(c => `${c.label}:${c.role}:${c.point}`).sort(), expectedCrashes.sort());
  const crashChecks = [], pids = new Set(); let readonlyAccounts = 0;
  for (const crash of r.crashes) {
    const { plan, planPath } = plans.get(crash.label), { role, marker } = crash;
    assert.equal(marker.point, crash.point); assert.equal(marker.role, role);
    assert(Number.isSafeInteger(marker.pid) && marker.pid > 0 && !pids.has(marker.pid)); pids.add(marker.pid);
    const invocations = r.appInvocations.filter(i => i.label === crash.label && i.crashPoint === crash.point && i.command === (role === 'query' ? 'approve-query' : 'approve-payment'));
    assert.equal(invocations.length, 1); const invocation = invocations[0];
    assert.equal(invocation.signal, 'SIGKILL'); assert.equal(invocation.code, null);
    assert.deepEqual(await json(invocation.marker), marker);
    const ticket = canonicalTicket(marker.ticket), approval = resolve(`${dirname(planPath)}-approvals`, `${descriptorDigest(plan.descriptor)}-${role}`);
    assert.equal(crash.approval, approval); assert.equal(ticket.journalDirectory, resolve(approval, 'signing/transaction-journal'));
    assert.equal(ticket.genesisHash, r.genesisHash); assert.equal(ticket.role, role); assert.equal(ticket.descriptorSha256, descriptorDigest(plan.descriptor));
    assert.deepEqual(crash.recovered.ticket, ticket); assert.deepEqual(crash.delivered.ticket, ticket);
    assert.deepEqual(await json(resolve(approval, 'ticket.json')), ticket);
    const intent = await json(resolve(approval, 'intent.json'));
    assert.equal(intent.owner, plan.descriptor.owner); assert.equal(intent.admin, plan.descriptor.admin); assert.equal(intent.role, role);
    assert.equal(intent.descriptorSha256, ticket.descriptorSha256); assert.equal(intent.genesisHash, r.genesisHash);
    assert.equal(intent.deploymentHash, descriptorDigest(r.deployment)); assert.equal(intent.journalDirectory, ticket.journalDirectory);
    assert.equal(crash.recovered.deliveryStatus, crash.point === 'after-wire' ? 'simulation-required' : 'prepared');
    assert.equal(crash.delivered.deliveryStatus, 'landed');
    boundary(crash.beforeRecovery, ticket, crash.point === 'after-simulation', false);
    boundary(crash.afterReadonlyRecovery, ticket, crash.point === 'after-simulation', true);
    assert.deepEqual(crash.beforeRecovery.journalEntries, crash.afterReadonlyRecovery.journalEntries);
    assert.deepEqual(crash.beforeRecovery.fileHashes, crash.afterReadonlyRecovery.fileHashes);
    const bytes = await readFile(resolve(ticket.journalDirectory, `${ticket.signature}.signed.json`));
    for (const [name, hash] of Object.entries(crash.beforeRecovery.fileHashes)) assert.equal(sha(await readFile(resolve(ticket.journalDirectory, name))), hash);
    const before = snapshot(`${crash.label}-${role}-before-crash`), after = snapshot(`${crash.label}-${role}-after-readonly-recovery`);
    assert(before.context.slot <= after.context.slot); assert.deepEqual(decodeSnapshot(before), decodeSnapshot(after)); readonlyAccounts += before.accounts.length;
    const landed = seen.get(ticket.signature); assert(landed); assert.equal(landed.entry.label, crash.label); assert.equal(landed.entry.role, role);
    const record = JSON.parse(bytes), tx = web3.VersionedTransaction.deserialize(Buffer.from(record.wireBase64, 'base64'));
    assert(Buffer.from(tx.message.serialize()).equals(Buffer.from(landed.message.serialize())));
    assert.deepEqual(tx.signatures.map(s => b58.encode(s)), landed.entry.transaction.transaction.signatures);
    assert.deepEqual(record.loadedAddresses, landed.entry.transaction.meta.loadedAddresses);
    const tables = new Map(); let w = 0, ro = 0;
    for (const lookup of tx.message.addressTableLookups) {
      const addresses = [];
      for (const index of lookup.writableIndexes) addresses[index] = new web3.PublicKey(record.loadedAddresses.writable[w++]);
      for (const index of lookup.readonlyIndexes) addresses[index] = new web3.PublicKey(record.loadedAddresses.readonly[ro++]);
      tables.set(lookup.accountKey.toBase58(), { context: { slot: landed.entry.slot }, value: { key: lookup.accountKey, state: { addresses } } });
    }
    const accounts = decodeSnapshot(before);
    const connection = { rpcEndpoint: instance.endpoint, getGenesisHash: async () => r.genesisHash,
      getAddressLookupTable: async key => { assert(tables.has(key.toBase58())); return tables.get(key.toBase58()); },
      getAccountInfoAndContext: async (key, options) => { const account = accounts.get(key.toBase58()); assert(account && !account.absent); assert(before.context.slot >= options.minContextSlot);
        return { context: before.context, value: { owner: new web3.PublicKey(account.owner), executable: account.executable, data: account.data } }; } };
    const sender = await DurableTransactionSender.open({ web3, connection, endpoint: instance.endpoint, directory: ticket.journalDirectory });
    const saved = await sender.read(ticket); assert.equal(saved.attempts, 1); assert.equal(saved.simulation.value.err, null);
    assert.equal(saved.broadcasts[0].response.outcome, 'accepted'); assert.equal(saved.broadcasts[0].response.returnedSignature, ticket.signature);
    await validateOperationTicket(plan, record, web3, connection);
    const readonlyInvocation = r.appInvocations.find(i => i.id === invocation.id + 1), submittedInvocation = r.appInvocations.find(i => i.id === invocation.id + 2);
    for (const i of [readonlyInvocation, submittedInvocation]) {
      assert.equal(i.command, 'recover'); assert.equal(i.code, 0); assert.equal(i.signal, null); assert.equal(i.label, crash.label);
      assert(!i.args.includes('--admin-keyfile') && !i.args.includes('--owner-keyfile'), 'Recovery worker was given signer paths');
    }
    assert(!readonlyInvocation.args.includes('--submit'));
    assert.equal(submittedInvocation.args[submittedInvocation.args.indexOf('--submit') + 1], 'yes');
    assert.deepEqual(JSON.parse(readonlyInvocation.stdout.trim().split('\n').at(-1)), crash.recovered);
    assert.deepEqual(JSON.parse(submittedInvocation.stdout.trim().split('\n').at(-1)), crash.delivered);
    crashChecks.push({ label: crash.label, role, point: crash.point, pid: marker.pid, signature: ticket.signature, wireSha256: ticket.wireSha256,
      readonlyUnchangedAccounts: before.accounts.length, originalJournal: relative(ROOT, ticket.journalDirectory) });
  }
  const callbackChecks = [], paid = [];
  for (const label of ['first', 'second']) {
    const { plan } = plans.get(label), d = plan.descriptor, t = validateOperation(d).template;
    const callbacks = r.callbacks.filter(c => c.label === label); assert.equal(callbacks.length, 1); const cb = callbacks[0];
    assert.equal(cb.program, d.deployment.programs.auth); assert.equal(cb.job, d.job); assert.equal(cb.computation, d.computation); assert.equal(cb.status, 1);
    const auth = seen.get(cb.signature).instructions.filter(ix => ix.program === d.deployment.programs.auth); assert.equal(auth.length, 1);
    const decoded = coder.decode(auth[0].data); assert.equal(decoded.name, 'runtime_policy_evaluate_callback');
    const output = decoded.data.output.Success[0];
    assert.deepEqual(JSON.parse(JSON.stringify({ field0: output.field_0, field1: output.field_1, field2: output.field_2 })), cb.output);
    assert.equal(output.field_1, true); assert(Buffer.from(output.field_0).equals(t.amountCommitment));
    for (const address of [d.job, d.computation, RUNTIME, d.quota, d.permit, d.deployment.programs.policy]) assert(auth[0].accounts.includes(address));
    const queryBefore = snapshot(`${label}-query-before-crash`), commitBefore = snapshot(`${label}-commit-before-crash`), paidAfter = snapshot(`${label}-paid`);
    const a = decodeSnapshot(queryBefore), b = decodeSnapshot(commitBefore), q0 = a.get(d.quota).data, q1 = b.get(d.quota).data;
    assert(queryBefore.context.slot <= cb.slot && cb.slot <= commitBefore.context.slot);
    assert(business(q0).equals(business(q1))); assert.equal(q1.readBigUInt64LE(88), q0.readBigUInt64LE(88) + 1n);
    for (const address of [t.source, t.destination, d.effect]) assert.deepEqual(a.get(address), b.get(address));
    const permit = b.get(d.permit).data;
    assert(permit.subarray(480, 512).equals(Buffer.from(output.field_2[0])));
    assert(permit.subarray(520, 616).equals(Buffer.concat(output.field_2.slice(1).map(v => Buffer.from(v)))));
    const job = decodeJob(b.get(d.job).data); assert.equal(b.get(d.job).owner, d.deployment.programs.auth);
    assert.equal(job.status, 1); assert.equal(job.owner, d.owner); assert.equal(job.permit, d.permit); assert.equal(job.computation, d.computation);
    assert.equal(job.inputsHash.toString('hex'), d.inputsHashHex);
    const entry = r.transactions.find(e => e.label === label && e.role === 'commit');
    const checked = verifyPaidTransition(commitBefore, paidAfter, entry, plan);
    for (const address of [t.source, t.destination]) { assert.equal(checked.before.get(address).owner, TOKEN_PROGRAM); assert(!checked.before.get(address).data.equals(checked.after.get(address).data)); }
    assert(checked.effect.subarray(8, 40).equals(new web3.PublicKey(d.owner).toBuffer()));
    assert.equal(checked.effect.subarray(40, 72).toString('hex'), d.productHex32); assert.equal(checked.effect.readBigUInt64LE(72).toString(), d.licenseExpirySlot);
    assert(entry.transaction.meta.logMessages.some(line => line.includes('ConfidentialTransferInstruction::Transfer')));
    assert(entry.transaction.meta.logMessages.includes(`Program ${TOKEN_PROGRAM} success`));
    callbackChecks.push({ label, signature: cb.signature, allowed: true, exactCommitmentAndSuccessor: true });
    paid.push({ label, signature: entry.signature, nativeAccountsChanged: true, exactPaidLicense: true });
  }
  const unsignedBefore = snapshot('before-wire-before'), unsignedAfter = snapshot('before-wire-after-refusals');
  assert.deepEqual(decodeSnapshot(unsignedBefore), decodeSnapshot(unsignedAfter));
  const unsignedInvocation = r.appInvocations.filter(i => i.label === 'before-wire' && i.crashPoint === 'before-wire'); assert.equal(unsignedInvocation.length, 1);
  assert.equal(unsignedInvocation[0].signal, 'SIGKILL'); const unsignedMarker = await json(unsignedInvocation[0].marker);
  assert.equal(unsignedMarker.ticket, null); assert.equal(unsignedMarker.point, 'before-wire'); assert.equal(unsignedMarker.role, 'query'); assert(!pids.has(unsignedMarker.pid));
  assert.deepEqual(unsignedMarker, r.interrupted.marker);
  assert.deepEqual(r.interrupted.beforeRefusals, r.interrupted.afterRefusals, 'Refusal changed the interrupted journal');
  const interrupted = r.interrupted.beforeRefusals;
  assert.equal(interrupted.ticket, null); assert(!interrupted.approvalEntries.includes('ticket.json'));
  assert(interrupted.approvalEntries.includes('intent.json')); assert(interrupted.journalEntries.includes('journal.json'));
  assert.deepEqual(Object.keys(interrupted.fileHashes).sort(), [...interrupted.journalEntries].sort());
  const interruptedPlan = plans.get('before-wire'), interruptedApproval = resolve(`${dirname(interruptedPlan.planPath)}-approvals`, `${descriptorDigest(interruptedPlan.plan.descriptor)}-query`);
  for (const [name, hash] of Object.entries(interrupted.fileHashes)) {
    const bytes = await readFile(resolve(interruptedApproval, 'signing/transaction-journal', name)); assert.equal(sha(bytes), hash);
    if (name.endsWith('.signed.json')) { const record = JSON.parse(bytes); assert(!record.descriptorSha256); assert.equal(record.category, 'lookup-table'); assert(!['query', 'commit'].includes(record.role)); }
  }
  assert.deepEqual(r.interrupted.refusals.map(item => item.command).sort(), ['approve-query', 'recover']);
  for (const refusal of r.interrupted.refusals) { assert.equal(refusal.code, 1); assert.match(refusal.stderr, /APPROVAL_INTERRUPTED_BEFORE_SIGNED_RECORD/); }
  const initial = decodeSnapshot(snapshot('first-query-before-crash')).get(r.deployment.quota).data;
  assert.equal(initial.readBigUInt64LE(0), 0n); assert.equal(r.initialState.version, '0'); assert.equal(initial.readBigUInt64LE(88).toString(), r.initialState.counter);
  const finalCounter = initial.readBigUInt64LE(88) + 2n;
  const final = decodeSnapshot(unsignedAfter).get(r.deployment.quota).data; checkState(final, r.deployment);
  assert.equal(final.readBigUInt64LE(0), 2n); assert.equal(final.readBigUInt64LE(88), finalCounter);
  assert.equal(r.finalState.version, '2'); assert.equal(r.finalState.counter, finalCounter.toString());
  assert(final.equals(decodeSnapshot(snapshot('second-paid')).get(r.deployment.quota).data));
  const expectedPrograms = [...['auth', 'policy', 'guard', 'merchant', 'license', 'proofBuffer'].map(name => r.deployment.programs[name]),
    RUNTIME, 'ArcStnN9zZZVB5WjgPhLHjYpY7Gb29mzb96ySsb1kxgq', 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95', TOKEN_PROGRAM];
  assert.equal(new Set(expectedPrograms).size, 10); assert.deepEqual(r.loadedPrograms.map(p => p.program).sort(), expectedPrograms.sort());
  for (const p of r.loadedPrograms) {
    assert.equal(p.matched, true); assert.equal(p.genesis_hash, r.genesisHash); assert.equal(p.elf_sha256, p.loaded_elf_sha256);
    const bytes = await readFile(p.local_elf_path); assert.equal(bytes.length, p.elf_bytes); assert.equal(sha(bytes), p.elf_sha256);
  }
  const circuitChecks = [];
  for (const name of ['runtime_policy_init', 'runtime_policy_evaluate']) {
    const c = await json(resolve(dirname(instancePath), `${name}-uploaded-evidence.json`)); assert.equal(c.circuit, name);
    assert.deepEqual(c, r.circuitArtifacts[name]);
    const definition = ar.getCompDefAccAddress(new web3.PublicKey(r.deployment.programs.auth), Buffer.from(ar.getCompDefAccOffset(name)).readUInt32LE());
    assert.equal(c.definition.address, definition.toBase58()); assert.equal(c.uploadAuthority, plans.get('first').plan.descriptor.admin);
    const bytes = await readFile(resolve(instance.releaseDirectory, 'circuits', `${name}.arcis`)), interfaceBytes = await readFile(resolve(instance.releaseDirectory, 'circuits', `${name}.idarc`));
    const accounts = [c.definition, ...c.rawAccounts];
    for (const account of accounts) { const data = Buffer.from(account.dataBase64, 'base64'); assert.equal(data.toString('base64'), account.dataBase64); assert.equal(data.length, account.dataLength); assert.equal(sha(data), account.dataSha256); }
    const checked = await verifyUploadedCircuit({ ar, arcium: { programId: new web3.PublicKey(RUNTIME), coder: { accounts: new anchor.BorshAccountsCoder(convertIdlToCamelCase(ar.ARCIUM_IDL)) } },
      definition, payer: new web3.PublicKey(c.uploadAuthority), bytes, interfaceBytes,
      connection: { getMultipleAccountsInfoAndContext: async (keys, options) => { assert.equal(options.commitment, 'confirmed'); assert.deepEqual(keys.map(k => k.toBase58()), accounts.map(a => a.address));
        return { context: { slot: c.contextSlot }, value: accounts.map(a => ({ owner: new web3.PublicKey(a.owner), executable: a.executable, data: Buffer.from(a.dataBase64, 'base64') })) }; } } });
    assert.deepEqual(checked, c); circuitChecks.push({ circuit: name, sha256: c.circuitSha256, bytes: c.circuitLength });
  }
  return { schema: 1, passed: true, evidenceLevel: 'independent-offline-session-crash-archive-review', input: { path: relative(ROOT, input), sha256: sha(raw), bytes: raw.length },
    counts: { messages: seen.size, ed25519Signatures: signatures, crashBoundaries: crashChecks.length, callbacks: callbackChecks.length, paidLicenses: paid.length,
      readonlyUnchangedAccounts: readonlyAccounts, signedTickets: crashChecks.length, loadedElfs: r.loadedPrograms.length, circuits: circuitChecks.length },
    crashes: crashChecks, callbacks: callbackChecks, paid, circuitChecks, initialQuota: { version: '0', counter: r.initialState.counter }, finalQuota: { version: '2', counter: finalCounter.toString() },
    sourceHashes: Object.fromEntries(await Promise.all(['examples/license-session/app.mjs', 'examples/license-session/crash.mjs', 'examples/license-session/qualify.mjs', 'examples/license-session/verify.mjs',
      'packages/policy-client/src/policy-session.mjs', 'packages/policy-client/src/approval-store.mjs'].map(async name => [name, sha(await readFile(resolve(ROOT, name)))]))),
    limitations: ['Offline review of retained local RPC and runner observations; no new execution, signer-file access or network calls.',
      'Ed25519 signatures and exact instruction/operation binding are checked; no independent BLS verification or historical consensus proof.',
      'SIGKILL, process IDs and historical directory captures are corroborating local runner evidence, not OS attestations.',
      'Before-wire means before durable signed-record publication; the sender may already have signed in memory.',
      'Loaded ELF reports are compared with current build bytes; raw loaded ProgramData is not independently retained by this verifier.',
      'Covers four selected publication/simulation crash boundaries and one interrupted attempt, not arbitrary provisioning or disk-loss recovery.'] };
}

export function parseArguments(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]; assert(['--results', '--instance', '--output', '--corruption-output'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--') && !Object.hasOwn(options, key));
    options[key] = args[i + 1];
  }
  assert(options['--results'] && options['--instance'] && options['--output'], 'Require --results, --instance and --output');
  return { resultsPath: resolve(options['--results']), instancePath: resolve(options['--instance']), output: resolve(options['--output']),
    ...(options['--corruption-output'] ? { corruptionOutput: resolve(options['--corruption-output']) } : {}) };
}
export async function reviewCorruptions(options) {
  const original = await json(options.resultsPath), rejected = [];
  const mutations = [
    ['missing historical ticket-absence evidence', r => { delete r.crashes[0].beforeRecovery; }],
    ['ticket falsely present at crash boundary', r => { r.crashes[0].beforeRecovery.approvalEntries.push('ticket.json'); }],
    ['hidden broadcast during read-only recovery', r => { const c = r.crashes[0]; c.afterReadonlyRecovery.journalEntries.push(`${c.marker.ticket.signature}.attempt-1.json`); }],
    ['changed retained-wire file hash', r => { const c = r.crashes[0]; c.beforeRecovery.fileHashes[`${c.marker.ticket.signature}.signed.json`] = '00'.repeat(32); }],
    ['different recovered signature', r => { r.crashes[0].recovered.ticket.signature = '1'.repeat(88); }],
    ['changed read-only account bytes', r => { const s = r.accountSnapshots.find(s => s.label === 'first-query-after-readonly-recovery'); const a = s.accounts.find(a => !a.absent); a.lamports++; }],
    ['missing SIGKILL evidence', r => { r.appInvocations.find(i => i.crashPoint).signal = null; }],
    ['callback signature corruption', r => { const c = r.callbacks[0]; c.signature = '1'.repeat(88); c.transaction.transaction.signatures[0] = c.signature; }],
    ['false paid callback result', r => { r.callbacks[0].output.field1 = false; }],
    ['replaced runtime ELF identity', r => { r.loadedPrograms[0].program = r.loadedPrograms[1].program; }],
  ];
  for (const [name, mutate] of mutations) {
    const changed = structuredClone(original); mutate(changed);
    await assert.rejects(reviewSessionArchive({ ...options, resultsOverride: changed }), `Verifier accepted corruption: ${name}`);
    rejected.push(name);
  }
  return { schema: 1, passed: true, classification: 'offline-in-memory-archive-corruption-checks', archiveUnmodified: true, rejected };
}
async function main() {
  const options = parseArguments(process.argv.slice(2)), report = await reviewSessionArchive(options);
  if (options.corruptionOutput) {
    const corruptions = await reviewCorruptions(options);
    await writeFile(options.corruptionOutput, JSON.stringify(corruptions, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  }
  await writeFile(options.output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ passed: true, output: options.output, counts: report.counts }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
