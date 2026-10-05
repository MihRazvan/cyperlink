#!/usr/bin/env node
/** Offline review of a retained Console journey. No RPC, keys or account decryption. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { signedMessage, decodeSnapshot, verifyPaidTransition, checkState } from '../../examples/policies/qualification/archive.mjs';
import { descriptorDigest, validateOperationPlan } from '../../packages/policy-client/src/operation-plan.mjs';
import { expectedOperationInstruction, instructionJSON } from '../../packages/policy-client/src/operation-ticket.mjs';
import { validateOperation, reconcileOperation, decodeJob } from '../../packages/policy-client/src/sdk.mjs';
import { validateDeployment } from '../../packages/policy-client/src/deployment.mjs';
import { REPO, TOKEN_PROGRAM } from '../../packages/local-client/src/runtime.mjs';

const ARCIUM = 'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ';
const LIGHTHOUSE = 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95';
const labels = ['Funded policy denial', 'Design asset purchase', 'Competing license', 'Fresh license approval'];
const paidLabels = [labels[1], labels[3]];
const json = async path => JSON.parse(await readFile(path));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const businessState = bytes => Buffer.concat([bytes.subarray(0, 88), bytes.subarray(96)]);
const one = (items, message) => { assert.equal(items.length, 1, message); return items[0]; };

async function pinnedModules(moduleRoot) {
  const req = createRequire(resolve(moduleRoot, 'package.json'));
  for (const [name, version] of [['@solana/web3.js', '1.99.0'], ['@anchor-lang/core', '1.2.0'], ['@arcium-hq/client', '0.15.0']]) {
    let directory = dirname(req.resolve(name)), found;
    for (let i = 0; i < 8 && !found; i++, directory = dirname(directory)) {
      try { const manifest = await json(resolve(directory, 'package.json')); if (manifest.name === name) found = manifest.version; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    assert.equal(found, version, `Expected pinned ${name}`);
  }
  const bs58 = req('bs58');
  return { web3: req('@solana/web3.js'), anchor: req('@anchor-lang/core'), ar: req('@arcium-hq/client'), base58: bs58.default ?? bs58 };
}

/** Verify the exact supported instruction and its merged message privileges. */
function operationMessage(plan, role, archived, web3) {
  const expected = expectedOperationInstruction(plan, role, web3), { message, entry } = archived;
  assert(message.staticAccountKeys, 'Expected a V0 operation message');
  assert.equal(message.staticAccountKeys[0].toBase58(), plan.descriptor.admin);
  const signerKeys = message.staticAccountKeys.slice(0, message.header.numRequiredSignatures).map(key => key.toBase58()).sort();
  const expectedSigners = [...new Set([plan.descriptor.admin, ...expected.keys.filter(meta => meta.isSigner).map(meta => meta.pubkey.toBase58())])].sort();
  assert.deepEqual(signerKeys, expectedSigners, 'Signed owner/administrator set differs from the plan');
  const resolved = Object.fromEntries(['writable', 'readonly'].map(kind => [kind, (entry.transaction.meta.loadedAddresses?.[kind] ?? []).map(key => new web3.PublicKey(key))]));
  const decoded = web3.TransactionMessage.decompile(message, { accountKeysFromLookups: resolved });
  assert.equal(decoded.instructions.length, 2, 'Unexpected extra operation instructions');
  const budget = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1300000 });
  assert.deepEqual(instructionJSON(decoded.instructions[0]), instructionJSON(budget));
  const merged = new Map([[plan.descriptor.admin, { signer: true, writable: true }]]);
  for (const meta of expected.keys) {
    const key = meta.pubkey.toBase58(), previous = merged.get(key) ?? { signer: false, writable: false };
    merged.set(key, { signer: previous.signer || meta.isSigner, writable: previous.writable || meta.isWritable });
  }
  const expectedJSON = instructionJSON(expected);
  expectedJSON.accounts = expectedJSON.accounts.map(meta => ({ key: meta.key, ...merged.get(meta.key) }));
  assert.deepEqual(instructionJSON(decoded.instructions[1]), expectedJSON, 'Signed instruction differs from retained native/consumer intent');
  const allowedKeys = new Set([plan.descriptor.admin, budget.programId.toBase58(), expected.programId.toBase58(), ...merged.keys()]);
  assert(archived.keys.every(key => allowedKeys.has(key)), 'Unexpected operation message account');
  const wire = new web3.VersionedTransaction(message, entry.transaction.transaction.signatures.map(signature => archived.base58.decode(signature))).serialize();
  return { role, signature: entry.signature, wireSha256: sha(wire), instructionSha256: sha(expected.data), signers: signerKeys };
}

function reconcile(plan, snapshot) {
  const accounts = decodeSnapshot(snapshot), d = plan.descriptor;
  return reconcileOperation(d, { slot: snapshot.context.slot, commitment: snapshot.commitment,
    accounts: [d.job, d.permit, d.quota, d.effect].map(address => { const account = accounts.get(address); assert(account); return account.absent ? null : account; }) });
}

export async function reviewConsoleArchive({ resultsPath, instancePath, resultsOverride }) {
  const input = resolve(resultsPath), raw = await readFile(input), r = resultsOverride ?? JSON.parse(raw);
  assert.equal(r.schema, 1); assert.equal(r.passed, true); assert.equal(r.classification, 'real-local-browser-sdk-journey');
  assert.equal(resolve(r.instancePath), resolve(instancePath)); assert.deepEqual(r.browserErrors, []); assert.equal(r.failure, undefined);
  const instance = await json(instancePath), deployment = validateDeployment(instance.descriptor);
  assert.equal(instance.schema, 1); assert.equal(instance.passed, true);
  const { web3, anchor, ar, base58 } = await pinnedModules(instance.moduleRoot);
  const idl = await json(instance.idl); assert.equal(idl.address, deployment.programs.auth);
  const coder = new anchor.BorshInstructionCoder(idl);
  const callbackDefinition = one(idl.instructions.filter(ix => ix.name === 'runtime_policy_evaluate_callback'), 'Missing supported callback ABI');
  assert.equal(r.operations.length, 4); assert.equal(r.callbacks.length, 4); assert.equal(r.transactions.length, 6);
  const operations = new Map(), ids = new Set();
  for (const op of r.operations) {
    assert(labels.includes(op.label) && !operations.has(op.label) && !ids.has(op.id)); ids.add(op.id);
    const plan = validateOperationPlan(op.plan);
    assert.deepEqual(plan.descriptor.deployment, deployment); assert.equal(plan.genesisHash, deployment.genesisHash);
    assert.equal(plan.label, `console-${sha(op.id).slice(0, 32)}`);
    expectedOperationInstruction(plan, 'query', web3); expectedOperationInstruction(plan, 'commit', web3);
    operations.set(op.label, { ...op, plan, template: validateOperation(plan.descriptor).template });
  }
  for (const field of ['job', 'computation', 'permit']) assert.equal(new Set([...operations.values()].map(op => op.plan.descriptor[field])).size, 4, `Reused ${field}`);
  assert.equal(new Set([...operations.values()].map(op => op.plan.action)).size, 4);
  const seen = new Map(); let signatureCount = 0;
  for (const entry of [...r.transactions, ...r.callbacks]) {
    assert(!seen.has(entry.signature), 'Duplicate archived receipt'); assert.equal(entry.transaction.meta.err, null);
    const decoded = signedMessage(entry, web3, base58); signatureCount += decoded.signatures;
    seen.set(entry.signature, { entry, ...decoded, base58 });
  }
  const snapshots = new Map();
  for (const snapshot of r.accountSnapshots) { assert(!snapshots.has(snapshot.label)); decodeSnapshot(snapshot); snapshots.set(snapshot.label, snapshot); }
  const expectedSnapshots = [...labels.flatMap(label => [`${label}-query-before`, `${label}-callback-after`]),
    ...paidLabels.flatMap(label => [`${label}-payment-before`, `${label}-payment-after`])].sort();
  assert.deepEqual([...snapshots.keys()].sort(), expectedSnapshots);
  const snap = name => { const value = snapshots.get(name); assert(value, `Missing ${name}`); return value; };
  const final = r.final; assert(final && final.busy === false); assert.equal(final.operations.length, 4);
  assert.equal(final.project.release, deployment.releaseHashHex); assert.equal(final.project.genesis, deployment.genesisHash);
  const visible = new Map(final.operations.map(op => [op.id, op])); assert.equal(visible.size, 4);
  assert.equal(r.observerDisclosures?.syntheticReferencePolicy, true);
  assert.equal(r.observerDisclosures.purchaseCap, 40); assert.equal(r.observerDisclosures.amounts?.length, 4);
  assert.equal(r.observerDisclosures.amounts[0], 50);
  for (const [index, label] of labels.entries()) {
    const view = visible.get(operations.get(label).id);
    assert.equal(view.sourceId, index < 2 ? 'a' : 'b');
    assert.equal(view.amount, String(r.observerDisclosures.amounts[index]));
  }
  const signedOperations = [], callbacks = [], payments = [];
  const expectedDecision = new Map(labels.map((label, index) => [label, index !== 0]));
  for (const [label, operation] of operations) {
    const { plan, template, id } = operation, d = plan.descriptor, view = visible.get(id);
    assert(view && view.title === label && view.busy === false && !view.error);
    assert.equal(view.planHash, descriptorDigest(d)); assert.equal(view.consumer.kind, d.consumerKind);
    if (d.consumerKind === 'merchant') assert.equal(view.consumer.sku, d.sku);
    else { assert.equal(view.consumer.productHex32, d.productHex32); assert.equal(view.consumer.expirySlot, d.licenseExpirySlot); }
    const before = snap(`${label}-query-before`), after = snap(`${label}-callback-after`), b = decodeSnapshot(before), a = decodeSnapshot(after);
    const addresses = [d.job, d.permit, d.quota, d.effect, template.source, template.destination].sort();
    assert.deepEqual([...a.keys()].sort(), addresses); assert.deepEqual([...b.keys()].sort(), addresses);
    assert.equal(reconcile(plan, before).status, 'unobserved');
    assert.equal(b.get(d.job).absent, true); assert(b.get(d.permit).data.every(byte => byte === 0));
    assert(b.get(d.quota).data.equals(Buffer.from(plan.quotaSnapshotHex, 'hex')));
    const query = one(r.transactions.filter(entry => entry.label === `${label}-query`), 'Expected one exact owner-approved query receipt');
    const signed = operationMessage(plan, 'query', seen.get(query.signature), web3);
    assert.equal(view.deliveries.query.signature, signed.signature); assert.equal(view.deliveries.query.wireSha256, signed.wireSha256); signedOperations.push({ label, ...signed });
    const cb = one(r.callbacks.filter(entry => entry.label === label), 'Expected one exact callback');
    assert.equal(cb.program, deployment.programs.auth); assert.equal(cb.job, d.job); assert.equal(cb.computation, d.computation);
    assert(before.context.slot <= query.slot && query.slot <= cb.slot && cb.slot <= after.context.slot, 'Query/callback receipts are not bracketed by snapshots');
    const archived = seen.get(cb.signature);
    const candidates = archived.instructions.map((ix, index) => ({ ix, index })).filter(({ ix }) => ix.program === deployment.programs.auth && ix.data.subarray(0, 8).equals(Buffer.from(callbackDefinition.discriminator)));
    const { ix, index } = one(candidates, 'Expected exact authenticated callback instruction');
    assert(index > 0 && archived.instructions[index - 1].program === ARCIUM, 'Callback lacks runtime predecessor instruction');
    assert.equal(archived.instructions.slice(-2).length, 2); assert(archived.instructions.slice(-2).every(instruction => instruction.program === LIGHTHOUSE));
    assert.equal(ix.accounts.length, callbackDefinition.accounts.length);
    const accounts = Object.fromEntries(callbackDefinition.accounts.map((item, i) => [item.name, ix.accounts[i]]));
    const auth = new web3.PublicKey(deployment.programs.auth);
    const expectedAccounts = { arcium_program: ARCIUM, job: d.job, computation_account: d.computation, quota: d.quota, permit: d.permit,
      policy_program: deployment.programs.policy, admission: web3.PublicKey.findProgramAddressSync([Buffer.from('admission')], auth)[0].toBase58(),
      mxe_account: ar.getMXEAccAddress(auth).toBase58(), comp_def_account: ar.getCompDefAccAddress(auth, Buffer.from(ar.getCompDefAccOffset('runtime_policy_evaluate')).readUInt32LE()).toBase58(),
      cluster_account: ar.getClusterAccAddress(0).toBase58(), instructions_sysvar: web3.SYSVAR_INSTRUCTIONS_PUBKEY.toBase58() };
    assert.deepEqual(accounts, expectedAccounts, 'Callback account binding differs from the plan/runtime');
    const decoded = coder.decode(ix.data); assert.equal(decoded.name, 'runtime_policy_evaluate_callback');
    const value = decoded.data.output.Success?.[0]; assert(value, 'Expected successful runtime callback output');
    const output = { field0: value.field_0, field1: value.field_1, field2: value.field_2 };
    assert.deepEqual(JSON.parse(JSON.stringify(output)), cb.output); assert.equal(output.field1, expectedDecision.get(label));
    assert(Buffer.from(output.field0).equals(template.amountCommitment), 'Callback native commitment differs');
    assert(Array.isArray(output.field2) && output.field2.length === 4 && output.field2.every(cipher => Array.isArray(cipher) && cipher.length === 32 && cipher.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255)));
    assert.equal(cb.status, output.field1 ? 1 : 2);
    const q0 = b.get(d.quota), q1 = a.get(d.quota);
    for (const quota of [q0, q1]) { assert.equal(quota.owner, deployment.programs.policy); checkState(quota.data, deployment); }
    for (const key of ['owner', 'lamports', 'executable']) assert.equal(q0[key], q1[key]);
    assert(businessState(q0.data).equals(businessState(q1.data))); assert.equal(q1.data.readBigUInt64LE(88), q0.data.readBigUInt64LE(88) + 1n);
    for (const address of [template.source, template.destination, d.effect]) assert.deepEqual(a.get(address), b.get(address), 'Query changed a native/business account');
    const job = decodeJob(a.get(d.job).data); assert.equal(a.get(d.job).owner, deployment.programs.auth);
    assert.equal(job.status, cb.status); assert.equal(job.owner, d.owner); assert.equal(job.computation, d.computation); assert.equal(job.permit, d.permit);
    assert.equal(job.inputsHash.toString('hex'), d.inputsHashHex); assert(job.template.bytes.equals(Buffer.from(d.templateHex, 'hex')));
    const observation = reconcile(plan, after); assert.equal(observation.status, output.field1 ? 'authorized' : 'denied');
    if (output.field1) {
      const permit = a.get(d.permit).data;
      assert(permit.subarray(480, 512).equals(Buffer.from(output.field2[0])));
      assert(permit.subarray(520, 616).equals(Buffer.concat(output.field2.slice(1).map(cipher => Buffer.from(cipher)))));
    } else assert(a.get(d.permit).data.every(byte => byte === 0));
    callbacks.push({ label, signature: cb.signature, job: d.job, computation: d.computation, allowed: output.field1,
      exactNativeCommitment: true, fullJobAndPermitBinding: true, allFourCiphertextsChecked: true, counterAdvancedExactlyOnce: true, nativeAndBusinessAccountsUnchanged: true });
  }
  for (const label of paidLabels) {
    const { plan, template, id } = operations.get(label), d = plan.descriptor;
    const entry = one(r.transactions.filter(receipt => receipt.label === `${label}-commit`), 'Expected one exact owner-approved payment receipt');
    const signed = operationMessage(plan, 'commit', seen.get(entry.signature), web3), view = visible.get(id);
    assert.equal(view.deliveries.commit.signature, signed.signature); assert.equal(view.deliveries.commit.wireSha256, signed.wireSha256);
    signedOperations.push({ label, ...signed });
    const before = snap(`${label}-payment-before`), after = snap(`${label}-payment-after`);
    assert.equal(reconcile(plan, before).status, 'authorized'); assert.equal(reconcile(plan, after).status, 'committed');
    const checked = verifyPaidTransition(before, after, entry, plan);
    assert.deepEqual(checked.before.get(d.job), checked.after.get(d.job), 'Payment changed the immutable Job');
    for (const address of [template.source, template.destination]) {
      for (const key of ['owner', 'lamports', 'executable']) assert.equal(checked.before.get(address)[key], checked.after.get(address)[key]);
      assert.equal(checked.before.get(address).owner, TOKEN_PROGRAM); assert(!checked.before.get(address).data.equals(checked.after.get(address).data));
    }
    assert(checked.effect.subarray(8, 40).equals(new web3.PublicKey(d.owner).toBuffer()));
    if (d.consumerKind === 'merchant') { assert.equal(checked.effect.length, 49); assert.equal(checked.effect.readBigUInt64LE(40).toString(), d.sku); }
    else { assert.equal(checked.effect.length, 81); assert.equal(checked.effect.subarray(40, 72).toString('hex'), d.productHex32); assert.equal(checked.effect.readBigUInt64LE(72).toString(), d.licenseExpirySlot); }
    assert(entry.transaction.meta.logMessages.some(line => line.includes('ConfidentialTransferInstruction::Transfer')));
    assert(entry.transaction.meta.logMessages.includes(`Program ${TOKEN_PROGRAM} success`));
    assert.equal(view.paymentCommitted, true); assert.equal(view.observation.status, 'committed');
    payments.push({ label, consumerKind: d.consumerKind, signature: entry.signature, exactBuyerAndConsumerTerms: true,
      nativeSourceAndDestinationChanged: true, completeQuotaSuccessorAndConsumedPermit: true, beforeVersion: checked.before.get(d.quota).data.readBigUInt64LE(0).toString(), afterVersion: checked.after.get(d.quota).data.readBigUInt64LE(0).toString() });
  }
  const denied = operations.get(labels[0]), merchant = operations.get(labels[1]), old = operations.get(labels[2]), fresh = operations.get(labels[3]);
  assert.equal(denied.plan.descriptor.consumerKind, 'merchant'); assert.equal(merchant.plan.descriptor.consumerKind, 'merchant');
  assert.equal(old.plan.descriptor.consumerKind, 'license'); assert.equal(fresh.plan.descriptor.consumerKind, 'license');
  assert.notEqual(merchant.template.source, old.template.source); assert.equal(denied.template.source, merchant.template.source);
  assert.equal(old.template.source, fresh.template.source); assert.equal(old.plan.descriptor.owner, fresh.plan.descriptor.owner);
  assert.equal(old.plan.descriptor.effect, fresh.plan.descriptor.effect); assert.equal(old.plan.descriptor.productHex32, fresh.plan.descriptor.productHex32);
  assert(BigInt(fresh.plan.descriptor.licenseExpirySlot) > BigInt(old.plan.descriptor.licenseExpirySlot));
  const oldView = visible.get(old.id), freshView = visible.get(fresh.id), denialView = visible.get(denied.id);
  assert.equal(denialView.paymentCommitted, false); assert.equal(denialView.observation.status, 'denied'); assert.equal(denialView.deliveries.commit, undefined);
  assert.equal(oldView.supersededBy, fresh.id); assert.equal(oldView.phase, 'superseded'); assert.equal(oldView.observation, null);
  assert.equal(oldView.paymentCommitted, false); assert.deepEqual(oldView.actions, []); assert.equal(oldView.deliveries.commit, undefined);
  assert.equal(oldView.historicalObservation.status, 'stale');
  const staleStep = one(r.steps.filter(step => step.title === old.label && step.operation.observation?.status === 'stale'), 'Missing observed unpaid stale predecessor');
  const { slot: observedStaleSlot, ...observedStale } = staleStep.operation.observation;
  const { slot: historicalStaleSlot, ...historicalStale } = oldView.historicalObservation;
  assert.deepEqual(observedStale, historicalStale); assert(observedStaleSlot <= historicalStaleSlot);
  assert(historicalStaleSlot <= snap(`${fresh.label}-query-before`).context.slot); assert.equal(staleStep.operation.paymentCommitted, false);
  assert(!staleStep.operation.actions.includes('approve-payment')); assert.equal(staleStep.operation.id, old.id);
  const freshBefore = decodeSnapshot(snap(`${fresh.label}-query-before`));
  assert(freshBefore.get(fresh.plan.descriptor.effect).data.every(byte => byte === 0), 'Fresh approval reused an already-issued effect');
  assert(freshBefore.get(deployment.quota).data.readBigUInt64LE(0) > old.template.quotaVersion);
  assert.deepEqual(freshBefore.get(old.template.source), decodeSnapshot(snap(`${old.label}-callback-after`)).get(old.template.source));
  assert.equal(freshView.observation.licenseActive, true); assert(BigInt(freshView.observation.slot) < BigInt(fresh.plan.descriptor.licenseExpirySlot));
  const recoverSteps = r.steps.filter(step => step.title === fresh.label && step.operation.observation?.status === 'committed');
  assert(recoverSteps.length >= 2, 'Missing post-payment recovery observation');
  for (const step of recoverSteps) {
    assert.equal(step.operation.deliveries.commit.signature, freshView.deliveries.commit.signature);
    assert.equal(step.operation.deliveries.commit.wireSha256, freshView.deliveries.commit.wireSha256);
  }
  assert.equal(final.operations.filter(op => op.paymentCommitted).length, 2);
  const continuity = [
    [`${labels[0]}-callback-after`, `${labels[1]}-query-before`],
    [`${labels[1]}-callback-after`, `${labels[2]}-query-before`],
    [`${labels[2]}-callback-after`, `${labels[1]}-payment-before`],
    [`${labels[1]}-payment-after`, `${labels[3]}-query-before`],
    [`${labels[3]}-callback-after`, `${labels[3]}-payment-before`],
  ];
  for (const [earlier, later] of continuity) {
    assert(snap(earlier).context.slot <= snap(later).context.slot);
    assert.deepEqual(decodeSnapshot(snap(earlier)).get(deployment.quota), decodeSnapshot(snap(later)).get(deployment.quota), 'Unaccounted shared state transition');
  }
  const initialQuota = decodeSnapshot(snap(`${labels[0]}-query-before`)).get(deployment.quota).data;
  const finalQuota = decodeSnapshot(snap(`${fresh.label}-payment-after`)).get(deployment.quota).data;
  assert.equal(finalQuota.readBigUInt64LE(0), initialQuota.readBigUInt64LE(0) + 2n);
  assert.equal(finalQuota.readBigUInt64LE(88), initialQuota.readBigUInt64LE(88) + 4n);
  const sources = ['apps/console/qualify.mjs', 'apps/console/verify.mjs', 'apps/console/adapter.mjs', 'apps/console/service.mjs', 'apps/console/server.mjs',
    'apps/console/public/app.mjs', 'packages/policy-client/src/policy-session.mjs', 'packages/policy-client/src/operation-plan.mjs',
    'packages/policy-client/src/operation-ticket.mjs', 'packages/policy-client/src/sdk.mjs', 'examples/policies/qualification/archive.mjs'];
  return { schema: 1, passed: true, evidenceLevel: 'offline-console-browser-journey-archive-review',
    input: { path: relative(REPO, input), sha256: sha(raw), bytes: raw.length }, genesisHash: deployment.genesisHash, deploymentHash: descriptorDigest(deployment),
    counts: { plans: 4, messages: seen.size, ed25519Signatures: signatureCount, callbacks: callbacks.length, queryReceipts: 4, paymentReceipts: 2, snapshots: snapshots.size,
      paidMerchants: 1, paidLicenses: 1, supersededUnpaidRequests: 1 }, callbacks, signedOperations, payments,
    supersession: { oldOperation: old.id, newOperation: fresh.id, historicalStatus: 'stale', oldOperationPaid: false, laterSharedEffectAttributedOnlyToFreshOperation: true },
    recovery: { signature: freshView.deliveries.commit.signature, wireSha256: freshView.deliveries.commit.wireSha256, retainedIdentityAcrossObservedRecovery: true },
    quota: { initialVersion: initialQuota.readBigUInt64LE(0).toString(), finalVersion: finalQuota.readBigUInt64LE(0).toString(),
      initialCounter: initialQuota.readBigUInt64LE(88).toString(), finalCounter: finalQuota.readBigUInt64LE(88).toString() },
    sourceHashes: Object.fromEntries(await Promise.all(sources.map(async name => [name, sha(await readFile(resolve(REPO, name)))]))),
    limitations: ['Offline verification of retained confirmed local RPC receipts/account snapshots and browser-runner observations; no network calls, keys, decryption or new execution.',
      'Ed25519 signatures and exact query/commit instructions are checked. RPC account bytes, receipt metadata and ALT resolution remain trusted archive evidence, not historical consensus proofs.',
      'Callback identity, runtime predecessor and resulting state are checked; no independent BLS verification or independent-operator claim.',
      'Requested plaintext amounts and private policy outcomes are runner disclosures. This review binds the native amount commitment across plan and callback without decrypting live balances or policy state.',
      'Supersession is explicit Console history corroborated by stale quota and unissued shared-effect snapshots; no final old-permit snapshot or proof of absence of unarchived transactions is invented.',
      'Recovery preserves archived signature/wire identity; this journey does not inject network outages or process crashes.',
      'This review does not independently rerun loaded-ELF or circuit-upload verification. Source hashes identify files at review time, not an attestation of browser execution bytes.'] };
}

export function parseArguments(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(['--results', '--instance', '--output'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--') && !Object.hasOwn(options, args[i]), 'Expected unique --results, --instance and --output paths');
    options[args[i]] = args[i + 1];
  }
  assert(options['--results'] && options['--instance'] && options['--output']);
  const output = resolve(options['--output']); assert(output.startsWith(resolve(REPO, '.local') + '/'), 'Review output must be under ignored .local');
  return { resultsPath: resolve(options['--results']), instancePath: resolve(options['--instance']), output };
}

async function main() {
  const options = parseArguments(process.argv.slice(2)), report = await reviewConsoleArchive(options);
  await writeFile(options.output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ passed: true, output: options.output, counts: report.counts }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
