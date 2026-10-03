#!/usr/bin/env node
/** Offline qualification oracle, deliberately separate from the direct application.
 * SDK validators are used here only to cross-check the independently encoded client.
 */
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { signedMessage, decodeSnapshot, verifyPaidTransition, verifyRollback, checkState } from '../policies/qualification/archive.mjs';
import { validateOperationPlan, descriptorDigest, queryStateDigest } from '../../packages/policy-client/src/operation-plan.mjs';
import { canonicalHash, validateDeployment } from '../../packages/policy-client/src/deployment.mjs';
import { validateOperationTicket, instructionJSON } from '../../packages/policy-client/src/operation-ticket.mjs';
import { PolicyOperationClient } from '../../packages/policy-client/src/operation-client.mjs';
import { validateOperation, reconcileOperation } from '../../packages/policy-client/src/sdk.mjs';
import { verifyUploadedCircuit } from '../../packages/policy-cli/src/circuit-evidence.mjs';
import { TOKEN_PROGRAM } from '../../packages/local-client/src/runtime.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RUNTIME = 'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ';
const json = async path => JSON.parse(await readFile(path));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const business = q => Buffer.concat([q.subarray(0, 88), q.subarray(96)]);
const EXPECTED = new Map([['cap40', false], ['a30', true], ['competing30', true], ['fresh-b30', false], ['fresh-b20', true]]);

function oraclePlan(p) {
  assert.equal(p.schema, 'direct-license-v1');
  const descriptor = { deployment: p.deployment, profile: p.deployment.profile, consumerKind: 'license', owner: p.owner, admin: p.admin,
    quota: p.deployment.quota, permit: p.permit, job: p.job, computation: p.computation, effect: p.effect,
    productHex32: p.product, licenseExpirySlot: p.expiry, templateHex: p.queuedTemplate, inputsHashHex: p.inputsHash,
    queryStateHashHex: queryStateDigest(Buffer.from(p.quotaSnapshot, 'hex')).toString('hex') };
  return validateOperationPlan({ schema: 1, label: p.label, genesisHash: p.genesis, contextSlot: p.contextSlot, action: p.action,
    descriptor, quotaSnapshotHex: p.quotaSnapshot, mxePublicKeyHex: p.deployment.mxePublicKeyHex,
    query: { offset: p.query.offset, expiry: p.query.expiry, publicKeyHex: p.query.publicKey, clientNonceHex: p.query.nonce,
      amountCiphertextHex: p.query.amount, openingCiphertextHex: p.query.opening },
    binding: { nativeDataHex: p.native.native_instruction.data, sourceDataHex: p.sourceData,
      proofAddresses: p.native.proofs.map(proof => proof.context_address), proofDataHex: p.proofData } });
}
function observation(plan, s) {
  const accounts = decodeSnapshot(s), keys = [plan.descriptor.job, plan.descriptor.permit, plan.descriptor.quota, plan.descriptor.effect];
  return reconcileOperation(plan.descriptor, { slot: s.context.slot, commitment: s.commitment,
    accounts: keys.map(address => { const a = accounts.get(address); assert(a, 'Missing reconciled account'); return a.absent ? null : { address, owner: a.owner, executable: a.executable, data: a.data }; }) });
}

export async function reviewDirectArchive({ resultsPath, instancePath, baselineInstancePath, resultsOverride }) {
  const input = resolve(resultsPath), raw = await readFile(input), r = resultsOverride ?? JSON.parse(raw);
  assert.equal(r.passed, true); assert.equal(r.classification, 'direct-client-shared-cyperlink-enforcement-real-local');
  assert.equal(resolve(r.instancePath), resolve(instancePath));
  const instance = await json(instancePath); validateDeployment(r.deployment); assert.deepEqual(instance.descriptor, r.deployment);
  const req = createRequire(resolve(instance.moduleRoot, 'package.json'));
  const web3 = req('@solana/web3.js'), anchor = req('@anchor-lang/core'), ar = req('@arcium-hq/client'), BN = req('bn.js');
  const { convertIdlToCamelCase } = req('@anchor-lang/core/dist/cjs/idl.js');
  const b58m = req('bs58'), b58 = b58m.default ?? b58m;
  const idl = await json(instance.idl), coder = new anchor.BorshInstructionCoder(idl);
  const seen = new Map(); let signatures = 0;
  assert.equal(r.transactions.length, 10); assert.equal(r.callbacks.length, 5);
  for (const entry of [...r.transactions, ...r.callbacks]) {
    assert(!seen.has(entry.signature), 'Duplicated message archive');
    const decoded = signedMessage(entry, web3, b58); signatures += decoded.signatures; seen.set(entry.signature, { entry, ...decoded });
  }
  assert.equal(seen.size, 15); assert.equal(signatures, 25);
  assert.deepEqual(r.signedArchiveChecks, { messages: seen.size, ed25519Signatures: signatures });
  const snaps = new Map(r.accountSnapshots.map(s => [s.label, s])); assert.equal(snaps.size, r.accountSnapshots.length);
  const snap = label => { assert(snaps.has(label), `Missing snapshot ${label}`); return snaps.get(label); };
  const plans = new Map();
  for (const op of r.operations) {
    const direct = await json(op.planPath), plan = oraclePlan(direct); assert.equal(direct.label, op.label);
    assert.deepEqual(direct.deployment, r.deployment); assert.equal(direct.genesis, r.deployment.genesisHash);
    const wallet = { publicKey: new web3.PublicKey(direct.admin), signTransaction: () => { throw Error('Offline verifier cannot sign'); }, signAllTransactions: () => { throw Error('Offline verifier cannot sign'); } };
    const provider = new anchor.AnchorProvider({ rpcEndpoint: instance.endpoint }, wallet, { commitment: 'confirmed' });
    const program = new anchor.Program(idl, provider);
    const client = new PolicyOperationClient({ deployment: r.deployment, session: { web3, endpoint: instance.endpoint, payer: { publicKey: wallet.publicKey } }, provider, program, ar, BN });
    plan.instructions = { query: instructionJSON(await client.queryInstruction(plan)), commit: instructionJSON(client.commitInstruction(plan)) };
    assert(!plans.has(op.label)); plans.set(op.label, { plan, direct, ...op });
  }
  assert.deepEqual([...plans.keys()].sort(), [...EXPECTED.keys()].sort());
  assert.deepEqual(r.callbacks.map(c => c.label).sort(), [...EXPECTED.keys()].sort());
  const template = label => validateOperation(plans.get(label).plan.descriptor).template;
  assert.notEqual(template('a30').source, template('competing30').source, 'Stale competitor must have an independent native source');
  assert.equal(plans.get('a30').plan.descriptor.quota, plans.get('competing30').plan.descriptor.quota);
  const repeatBefore = snap('repeat-before'), repeatAfter = snap('repeat-after');
  assert(repeatBefore.context.slot <= repeatAfter.context.slot); assert.deepEqual(decodeSnapshot(repeatBefore), decodeSnapshot(repeatAfter));

  const callbacks = [];
  for (const cb of r.callbacks) {
    const { plan } = plans.get(cb.label), d = plan.descriptor, t = template(cb.label), landed = seen.get(cb.signature);
    assert.equal(cb.program, d.deployment.programs.auth); assert.equal(cb.job, d.job); assert.equal(cb.computation, d.computation);
    assert.equal(landed.entry.transaction.meta.err, null);
    const auth = landed.instructions.filter(ix => ix.program === d.deployment.programs.auth); assert.equal(auth.length, 1);
    const decoded = coder.decode(auth[0].data); assert.equal(decoded.name, 'runtime_policy_evaluate_callback');
    const output = decoded.data.output.Success[0];
    assert.deepEqual(JSON.parse(JSON.stringify({ field0: output.field_0, field1: output.field_1, field2: output.field_2 })), cb.output);
    assert.equal(output.field_1, EXPECTED.get(cb.label)); assert.equal(cb.status, output.field_1 ? 1 : 2);
    assert(Buffer.from(output.field_0).equals(t.amountCommitment));
    for (const key of [d.job, d.computation, d.permit, d.quota, RUNTIME, d.deployment.programs.policy]) assert(auth[0].accounts.includes(key));
    const before = snap(`${cb.label}-query-before`), after = snap(`${cb.label}-callback-after`), a = decodeSnapshot(before), b = decodeSnapshot(after);
    assert(before.context.slot <= cb.slot && cb.slot <= after.context.slot);
    const q0 = a.get(d.quota).data, q1 = b.get(d.quota).data;
    assert(business(q0).equals(business(q1))); assert.equal(q1.readBigUInt64LE(88), q0.readBigUInt64LE(88) + 1n);
    for (const address of [t.source, t.destination, d.effect]) assert.deepEqual(a.get(address), b.get(address));
    if (output.field_1) {
      const permit = b.get(d.permit).data;
      assert(permit.subarray(480, 512).equals(Buffer.from(output.field_2[0])));
      assert(permit.subarray(520, 616).equals(Buffer.concat(output.field_2.slice(1).map(value => Buffer.from(value)))));
    }
    assert.equal(observation(plan, after).status, output.field_1 ? 'authorized' : 'denied');
    callbacks.push({ label: cb.label, signature: cb.signature, allowed: output.field_1, immutableJobChecked: true, noPaymentAtCallback: true });
  }
  const paid = [];
  for (const label of ['a30', 'fresh-b20']) {
    const { plan } = plans.get(label), d = plan.descriptor, t = template(label), entry = r.transactions.find(e => e.label === label + '-paid'); assert(entry);
    const before = snap(label + '-payment-before'), after = snap(label + '-payment-after');
    const checked = verifyPaidTransition(before, after, entry, plan);
    for (const address of [t.source, t.destination]) { assert.equal(checked.before.get(address).owner, TOKEN_PROGRAM); assert(!checked.before.get(address).data.equals(checked.after.get(address).data)); }
    assert(checked.effect.subarray(8, 40).equals(new web3.PublicKey(d.owner).toBuffer()));
    assert.equal(checked.effect.subarray(40, 72).toString('hex'), d.productHex32); assert.equal(checked.effect.readBigUInt64LE(72).toString(), d.licenseExpirySlot);
    assert(entry.transaction.meta.logMessages.some(line => line.includes('ConfidentialTransferInstruction::Transfer')));
    assert(entry.transaction.meta.logMessages.includes(`Program ${TOKEN_PROGRAM} success`));
    assert.equal(observation(plan, after).status, 'committed');
    paid.push({ label, signature: entry.signature, exactNativeAndFourSlotSuccessor: true, exactLicenseEffect: true });
  }
  const rejected = [];
  for (const [label, code, op] of [['post-native-rollback', 1199, 'a30'], ['stale803', 803, 'competing30'], ['replay1102', 1102, 'a30']]) {
    const entry = r.transactions.find(e => e.label === label); assert(entry); const { plan, direct } = plans.get(op);
    assert.equal(entry.transaction.meta.err.InstructionError[1].Custom, code);
    const expected = plan.instructions.commit, instructions = seen.get(entry.signature).instructions;
    assert.equal(instructions.length, 2); const instruction = instructions[1]; assert.equal(instruction.program, expected.program);
    const data = Buffer.from(expected.data, 'hex'); if (code === 1199) data[41] = 1;
    assert(instruction.data.equals(data)); assert.deepEqual(instruction.accounts, expected.accounts.map(meta => meta.key));
    const wirePath = resolve(dirname(input), `${label}-wire.json`), record = await json(wirePath);
    assert.equal(record.signature, entry.signature); assert.equal(record.role, label); assert.equal(record.expectedError, code);
    assert.equal(record.planHash, canonicalHash(direct)); assert.equal(record.genesis, r.deployment.genesisHash); assert.equal(record.payer, direct.admin);
    const wire = Buffer.from(record.wire, 'base64'); assert.equal(wire.toString('base64'), record.wire); assert(wire.length <= 1232);
    const tx = web3.VersionedTransaction.deserialize(wire); assert.equal(tx.version, 0); assert(Buffer.from(tx.serialize()).equals(wire));
    assert(Buffer.from(tx.message.serialize()).equals(Buffer.from(seen.get(entry.signature).message.serialize())));
    assert.deepEqual(tx.signatures.map(signature => b58.encode(signature)), entry.transaction.transaction.signatures);
    const tables = record.tables.map(table => new web3.AddressLookupTableAccount({ key: new web3.PublicKey(table.key),
      state: { deactivationSlot: 0xffffffffffffffffn, lastExtendedSlot: 0, lastExtendedSlotStartIndex: 0, addresses: table.addresses.map(address => new web3.PublicKey(address)) } }));
    const consumer = new web3.TransactionInstruction({ programId: new web3.PublicKey(expected.program), data,
      keys: expected.accounts.map(meta => ({ pubkey: new web3.PublicKey(meta.key), isSigner: meta.signer, isWritable: meta.writable })) });
    const message = new web3.TransactionMessage({ payerKey: new web3.PublicKey(direct.admin), recentBlockhash: record.blockhash.blockhash,
      instructions: [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1300000 }), consumer] }).compileToV0Message(tables);
    assert(Buffer.from(message.serialize()).equals(Buffer.from(tx.message.serialize())), 'Rejected signed instruction privileges differ from exact intended failure');
    const simulation = await json(wirePath + '.simulation.json');
    assert.equal(simulation.value.err.InstructionError[1].Custom, code);
    if (record.storagePath !== undefined) {
      assert.equal(record.storagePath, wirePath);
      assert.deepEqual(simulation.directBinding, { signature: record.signature, wireSha256: sha(wire) });
    }
    const unchanged = verifyRollback(snap(label + '-before'), snap(label + '-after'), entry);
    if (code === 1199) {
      assert(entry.transaction.meta.logMessages.some(line => line.includes('ConfidentialTransferInstruction::Transfer')));
      assert(entry.transaction.meta.logMessages.includes(`Program ${TOKEN_PROGRAM} success`));
    }
    if (code === 803) assert.equal(observation(plan, snap(label + '-before')).status, 'stale');
    if (code === 1102) assert.equal(observation(plan, snap(label + '-before')).status, 'committed');
    rejected.push({ label, code, signature: entry.signature, unchangedAccounts: unchanged });
  }

  assert.equal(r.tickets.length, 7);
  assert.deepEqual(r.tickets.map(t => `${t.label}:${t.role}`).sort(), [...EXPECTED.keys()].map(label => `${label}:query`).concat(['a30:commit', 'fresh-b20:commit']).sort());
  const tickets = []; let durableAttemptRecords = 0;
  for (const ticket of r.tickets) {
    const { plan, direct, planPath } = plans.get(ticket.label), wirePath = resolve(dirname(planPath), `${ticket.role}-wire.json`), record = await json(wirePath);
    assert.equal(record.schema, 'direct-wire-v1'); assert.equal(record.role, ticket.role); assert.equal(record.planHash, canonicalHash(direct));
    assert.equal(record.genesis, r.deployment.genesisHash); assert.equal(record.payer, direct.admin); assert.equal(record.signature, ticket.signature);
    assert(Number.isSafeInteger(record.minSlot) && record.minSlot >= plan.contextSlot);
    assert(Number.isSafeInteger(record.blockhash.lastValidBlockHeight) && record.blockhash.lastValidBlockHeight >= 0);
    const wire = Buffer.from(record.wire, 'base64'); assert.equal(wire.toString('base64'), record.wire); assert(wire.length <= 1232);
    assert.equal(sha(wire), ticket.wireSha256);
    const tx = web3.VersionedTransaction.deserialize(wire), landed = seen.get(ticket.signature); assert(landed); assert.equal(landed.entry.transaction.meta.err, null);
    assert.equal(tx.message.recentBlockhash, record.blockhash.blockhash); assert.equal(b58.encode(tx.signatures[0]), record.signature);
    assert(Buffer.from(tx.message.serialize()).equals(Buffer.from(landed.message.serialize())));
    assert.deepEqual(tx.signatures.map(signature => b58.encode(signature)), landed.entry.transaction.transaction.signatures);
    assert(landed.entry.slot >= record.minSlot);
    const loaded = { writable: [], readonly: [] }, tables = new Map();
    for (const table of record.tables) { assert(!tables.has(table.key)); tables.set(table.key, table); }
    for (const lookup of tx.message.addressTableLookups) {
      const table = tables.get(lookup.accountKey.toBase58()); assert(table);
      for (const i of lookup.writableIndexes) { assert(table.addresses[i]); loaded.writable.push(table.addresses[i]); }
      for (const i of lookup.readonlyIndexes) { assert(table.addresses[i]); loaded.readonly.push(table.addresses[i]); }
    }
    assert.deepEqual(loaded, landed.entry.transaction.meta.loadedAddresses);
    const before = snap(`${ticket.label}-${ticket.role === 'query' ? 'query' : 'payment'}-before`), accounts = decodeSnapshot(before);
    const sdkRecord = { genesisHash: record.genesis, descriptorSha256: descriptorDigest(plan.descriptor), role: ticket.role, wireBase64: record.wire,
      wireSha256: ticket.wireSha256, minContextSlot: record.minSlot, loadedAddresses: loaded };
    const semantics = await validateOperationTicket(plan, sdkRecord, web3, {
      getAddressLookupTable: async key => { const table = tables.get(key.toBase58()); assert(table); return { context: { slot: landed.entry.slot }, value: { key, state: { addresses: table.addresses.map(address => new web3.PublicKey(address)) } } }; },
      getAccountInfoAndContext: async (key, options) => { const a = accounts.get(key.toBase58()); assert(a && !a.absent); assert(before.context.slot >= options.minContextSlot);
        return { context: before.context, value: { owner: new web3.PublicKey(a.owner), executable: a.executable, data: a.data } }; } });
    if (ticket.role === 'query') {
      assert(accounts.get(direct.native.source).data.equals(Buffer.from(direct.sourceData, 'hex')));
      for (let i = 0; i < direct.native.proofs.length; i++) assert(accounts.get(direct.native.proofs[i].context_address).data.equals(Buffer.from(direct.proofData[i], 'hex')));
    }
    const simulation = await json(wirePath + '.simulation.json');
    assert.equal((simulation.simulation ?? simulation).value.err, null);
    if (record.storagePath !== undefined) {
      assert.equal(record.storagePath, wirePath);
      assert.deepEqual(simulation.directBinding, { signature: ticket.signature, wireSha256: ticket.wireSha256 });
      const intent = await json(resolve(dirname(planPath), `${ticket.role}-approval-intent.json`));
      assert.deepEqual(intent, { role: ticket.role, planHash: canonicalHash(direct), owner: direct.owner, admin: direct.admin });
      const names = (await readdir(wirePath + '.attempts')).filter(name => /^attempt-[0-9]+\.json$/.test(name));
      assert(names.length > 0 && names.length <= 3, 'Durable attempt bound violated');
      for (let i = 1; i <= names.length; i++) {
        assert(names.includes(`attempt-${i}.json`)); const attempt = await json(resolve(wirePath + '.attempts', `attempt-${i}.json`));
        assert.equal(attempt.signature, ticket.signature); assert.equal(attempt.wireSha256, ticket.wireSha256); durableAttemptRecords++;
      }
    }
    tickets.push({ label: ticket.label, role: ticket.role, signature: ticket.signature, wireSha256: ticket.wireSha256,
      instructionSha256: semantics.instructionSha256, immutablePreparedActionChecked: Boolean(semantics.preparedAction) });
  }
  const repeated = r.appInvocations.filter(i => i.command === 'approve-query' && i.label === 'a30' && i.signal !== 'SIGKILL'); assert.equal(repeated.length, r.crashWindows ? 1 : 2);
  const repeatedSignature = tickets.find(t => t.label === 'a30' && t.role === 'query').signature;
  for (const invocation of repeated) { assert.equal(invocation.exitCode, 0); assert.equal(invocation.summary.signature, repeatedSignature); }
  const faults = {};
  for (const mode of ['lost-ack', 'unavailable-receipt']) faults[mode] = (await readFile(resolve(dirname(input), mode + '.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
  assert.deepEqual(r.injectedFaults.map(f => [f.mode, f.events]), Object.entries(faults));
  const lost = faults['lost-ack'].filter(e => e.fault === 'actual-send-response-lost'); assert.equal(lost.length, 1);
  const payment = tickets.find(t => t.label === 'a30' && t.role === 'commit'); assert.equal(lost[0].signature, payment.signature); assert.equal(lost[0].wireSha256, payment.wireSha256);
  for (const events of Object.values(faults)) assert(events.some(e => e.fault === 'receipt-unavailable'));
  assert(!faults['unavailable-receipt'].some(e => e.fault === 'actual-send-response-lost'));
  assert.notEqual(lost[0].processId, faults['unavailable-receipt'][0].processId);
  const recovery = [];
  const retainedObservations = new Map();
  for (const [label, { planPath }] of plans) {
    const directory = resolve(dirname(planPath), 'observations');
    retainedObservations.set(label, await Promise.all((await readdir(directory)).filter(name => name.endsWith('.json')).map(name => json(resolve(directory, name)))));
  }
  for (const [index, invocation] of r.appInvocations.entries()) {
    const detail = await json(resolve(dirname(input), `invocation-${index}.json`)); assert.equal(detail.code, invocation.exitCode);
    if (invocation.signal === 'SIGKILL') {
      assert.equal(detail.signal, 'SIGKILL'); assert.equal(detail.code, null); assert.equal(invocation.summary.parseError, true); continue;
    }
    assert.deepEqual(JSON.parse(detail.code ? detail.stderr.trim().split('\n').at(-1) : detail.stdout), invocation.summary);
    if (invocation.summary.slot !== undefined) {
      const { plan } = plans.get(invocation.label), d = plan.descriptor;
      const matching = retainedObservations.get(invocation.label).filter(row => row.slot === invocation.summary.slot && row.status === invocation.summary.status);
      assert(matching.length > 0, 'Invocation lacks retained same-slot account observation');
      for (const row of matching) {
        const addresses = [d.job, d.permit, d.quota, d.effect]; assert.equal(row.accounts.length, 4);
        const checked = reconcileOperation(d, { slot: row.slot, commitment: row.commitment, accounts: row.accounts.map((a, i) => a ? {
          address: addresses[i], owner: a.owner, executable: a.executable, data: Buffer.from(a.data, 'base64'),
        } : null) });
        assert.equal(checked.status, row.status); assert.equal(row.status, invocation.summary.status);
        assert.equal(invocation.summary.paymentCommitted, checked.status === 'committed');
      }
    }
    if (invocation.command !== 'recover') continue;
    assert(!detail.args.includes('--admin-keyfile') && !detail.args.includes('--owner-keyfile'), 'Keyless recovery invocation has signer paths');
    if (!invocation.faultInjected && invocation.summary.deliveryStatus === 'confirmed') {
      const role = detail.args[detail.args.indexOf('--role') + 1];
      const ticket = tickets.find(t => t.label === invocation.label && t.role === role); assert(ticket); assert.equal(invocation.summary.signature, ticket.signature);
      assert.deepEqual(invocation.summary.delivery.receipt, seen.get(ticket.signature).entry.transaction);
      if (role === 'commit') { assert.equal(invocation.summary.status, 'committed'); recovery.push({ label: invocation.label, signature: ticket.signature, keylessArguments: true }); }
    }
  }
  assert.deepEqual([...new Set(recovery.map(item => item.label))].sort(), ['a30', 'fresh-b20']);
  const crashChecks = []; let readonlyCrashAccounts = 0;
  if (r.crashWindows) {
    assert.deepEqual(r.crashWindows.map(c => c.label).sort(), ['a30-query-after-wire', 'competing30-query-after-simulation', 'a30-commit-after-simulation', 'fresh-b20-commit-after-wire', 'before-wire-unsubmitted-query-before-wire'].sort());
    const pids = new Set();
    for (const crash of r.crashWindows) {
      const { role, phase } = crash, label = crash.label.slice(0, -(`-${role}-${phase}`).length);
      const op = phase === 'before-wire' ? { ...r.interruptedOperation, direct: await json(r.interruptedOperation.planPath) } : plans.get(label);
      assert(op); assert.equal(op.label, label); oraclePlan(op.direct);
      const path = resolve(dirname(op.planPath), `${role}-wire.json`), before = crash.beforeRecovery, after = crash.afterReadonlyRecovery;
      assert.equal(crash.signal, 'SIGKILL'); const invocation = r.appInvocations[crash.invocation]; assert.equal(invocation.signal, 'SIGKILL'); assert.equal(invocation.label, label);
      const marker = (await readFile(crash.markerPath, 'utf8')).trim().split('\n').map(JSON.parse); assert.deepEqual(marker, crash.marker); assert.equal(marker.length, 1);
      assert.equal(marker[0].phase, phase); assert.equal(marker[0].signal, 'SIGKILL');
      assert.equal(marker[0].target, path + (phase === 'after-simulation' ? '.simulation.json' : ''));
      assert(Number.isSafeInteger(marker[0].pid) && marker[0].pid > 0 && !pids.has(marker[0].pid)); pids.add(marker[0].pid);
      for (const capture of [before, after]) {
        assert(Array.isArray(capture.directoryEntries)); assert(capture.directoryEntries.includes(`${role}-approval-intent.json`));
        assert.deepEqual(capture.attemptEntries, []); assert.equal(capture.directoryEntries.includes(`${role}-wire.json`), phase !== 'before-wire');
        assert.equal(capture.directoryEntries.includes(`${role}-wire.json.simulation.json`), phase === 'after-simulation');
        assert.equal(capture.simulation === null, phase !== 'after-simulation');
      }
      assert.deepEqual(before.wire, after.wire); assert.equal(before.wireFileSha256, after.wireFileSha256); assert.deepEqual(before.simulation, after.simulation);
      const beforeAccounts = snap(crash.beforeSnapshot), afterAccounts = snap(crash.afterReadonlySnapshot);
      assert(beforeAccounts.context.slot <= afterAccounts.context.slot); assert.deepEqual(decodeSnapshot(beforeAccounts), decodeSnapshot(afterAccounts)); readonlyCrashAccounts += beforeAccounts.accounts.length;
      if (phase === 'before-wire') {
        assert.equal(before.wire, null); assert.equal(after.wire, null);
        assert.equal(crash.readonlyOutcome.paymentCommitted, false); assert.equal(crash.repeatRefusal.paymentCommitted, false);
        assert.match(crash.readonlyOutcome.error, /ENOENT|no such file/i); assert.match(crash.repeatRefusal.error, /Interrupted approval intent/);
        for (const [offset, command, summary] of [[1, 'recover', crash.readonlyOutcome], [2, 'approve-query', crash.repeatRefusal]]) {
          const refusal = r.appInvocations[crash.invocation + offset]; assert.equal(refusal.command, command); assert.equal(refusal.exitCode, 1); assert.equal(refusal.label, label);
          const { exitCode, invocation, ...outcome } = summary;
          assert.equal(exitCode, 1); assert.equal(invocation, crash.invocation + offset); assert.deepEqual(refusal.summary, outcome);
        }
      } else {
        const ticket = tickets.find(t => t.label === label && t.role === role); assert(ticket);
        assert.equal(before.wire.signature, ticket.signature); assert.equal(before.wireSha256, ticket.wireSha256);
        assert.equal(sha(await readFile(path)), before.wireFileSha256); assert.deepEqual(await json(path), before.wire);
        assert.equal(crash.readonlyOutcome.signature, ticket.signature);
        assert.equal(crash.readonlyOutcome.deliveryStatus, phase === 'after-wire' ? 'simulation-required' : 'pending');
        if (phase === 'after-wire') assert.equal(crash.readonlyOutcome.delivery.canBroadcast, false);
        assert.equal(crash.readonlyOutcome.delivery.attemptsUsed, 0);
        assert.equal(crash.afterSubmission.wireFileSha256, before.wireFileSha256);
        assert.equal(crash.afterSubmission.wireSha256, ticket.wireSha256);
        assert(crash.afterSubmission.attemptEntries.includes('attempt-1.json'));
      }
      crashChecks.push({ label, role, phase, pid: marker[0].pid, readonlyUnchangedAccounts: beforeAccounts.accounts.length,
        ...(before.wire ? { signature: before.wire.signature, wireSha256: before.wireSha256 } : {}) });
    }
  }
  const q = Buffer.from(r.finalState.dataBase64, 'base64'); checkState(q, r.deployment);
  assert.equal(q.readBigUInt64LE(0), 2n); assert.equal(q.readBigUInt64LE(88), 6n);
  assert(q.equals(decodeSnapshot(snap('fresh-b20-payment-after')).get(r.deployment.quota).data));
  const expectedPrograms = [...['auth', 'policy', 'guard', 'merchant', 'license', 'proofBuffer'].map(name => r.deployment.programs[name]),
    RUNTIME, 'ArcStnN9zZZVB5WjgPhLHjYpY7Gb29mzb96ySsb1kxgq', 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95', TOKEN_PROGRAM];
  assert.equal(new Set(expectedPrograms).size, 10); assert.deepEqual(r.loadedPrograms.map(p => p.program).sort(), expectedPrograms.sort());
  for (const p of r.loadedPrograms) { assert.equal(p.matched, true); assert.equal(p.genesis_hash, r.deployment.genesisHash); const bytes = await readFile(p.local_elf_path);
    assert.equal(p.elf_bytes, bytes.length); assert.equal(p.elf_sha256, sha(bytes)); assert.equal(p.elf_sha256, p.loaded_elf_sha256); }
  assert.deepEqual(r.circuitArtifacts.map(c => c.circuit).sort(), ['runtime_policy_evaluate', 'runtime_policy_init']);
  const circuits = [];
  for (const c of r.circuitArtifacts) {
    assert.deepEqual(c, await json(resolve(dirname(instancePath), c.circuit + '-uploaded-evidence.json')));
    const definition = ar.getCompDefAccAddress(new web3.PublicKey(r.deployment.programs.auth), Buffer.from(ar.getCompDefAccOffset(c.circuit)).readUInt32LE());
    assert.equal(c.definition.address, definition.toBase58()); assert.equal(c.uploadAuthority, plans.get('a30').direct.admin);
    const bytes = await readFile(resolve(instance.releaseDirectory, 'circuits', c.circuit + '.arcis')), interfaceBytes = await readFile(resolve(instance.releaseDirectory, 'circuits', c.circuit + '.idarc'));
    const accounts = [c.definition, ...c.rawAccounts];
    for (const a of accounts) { const data = Buffer.from(a.dataBase64, 'base64'); assert.equal(data.toString('base64'), a.dataBase64); assert.equal(data.length, a.dataLength); assert.equal(sha(data), a.dataSha256); }
    const checked = await verifyUploadedCircuit({ ar, arcium: { programId: new web3.PublicKey(RUNTIME), coder: { accounts: new anchor.BorshAccountsCoder(convertIdlToCamelCase(ar.ARCIUM_IDL)) } },
      definition, payer: new web3.PublicKey(c.uploadAuthority), bytes, interfaceBytes,
      connection: { getMultipleAccountsInfoAndContext: async (keys, options) => { assert.equal(options.commitment, 'confirmed'); assert.deepEqual(keys.map(key => key.toBase58()), accounts.map(a => a.address));
        return { context: { slot: c.contextSlot }, value: accounts.map(a => ({ owner: new web3.PublicKey(a.owner), executable: a.executable, data: Buffer.from(a.dataBase64, 'base64') })) }; } } });
    assert.deepEqual(c, checked); circuits.push({ circuit: c.circuit, sha256: c.circuitSha256, bytes: c.circuitLength });
  }
  const sharedBoundary = { releaseHashHex: r.deployment.releaseHashHex, sharedNativeProofCliSha256: sha(await readFile(instance.proofCli)),
    compilerAndPolicyPackageShared: true, enforcementShared: true, fullStandaloneUpstreamComparison: 'inconclusive' };
  if (baselineInstancePath) {
    const baseline = await json(baselineInstancePath); validateDeployment(baseline.descriptor);
    for (const name of ['releaseHashHex', 'schemaHashHex', 'cipher', 'stateFields']) assert.deepEqual(r.deployment[name], baseline.descriptor[name]);
    assert.equal(sharedBoundary.sharedNativeProofCliSha256, sha(await readFile(baseline.proofCli)));
    for (const c of circuits) assert.equal(c.sha256, sha(await readFile(resolve(baseline.releaseDirectory, 'circuits', c.circuit + '.arcis'))));
    sharedBoundary.baselineInstance = relative(ROOT, baselineInstancePath); sharedBoundary.identicalPolicyCircuitsAndProofBridge = true;
  }
  const executedClientSources = [];
  if (r.executedClientSources) {
    assert.deepEqual(r.executedClientSources.map(s => s.path).sort(), ['abi.mjs', 'app.mjs', 'wire.mjs', 'crash-preload.mjs', 'qualify.mjs', 'rpc-fault.mjs'].map(name => 'examples/license-direct/' + name).sort());
    for (const source of r.executedClientSources) {
      const bytes = await readFile(resolve(dirname(input), 'executed-source', source.path.split('/').at(-1)));
      assert.equal(sha(bytes), source.sha256); assert.equal(sha(await readFile(resolve(ROOT, source.path))), source.sha256, 'Live source changed from frozen executed snapshot');
      executedClientSources.push(source);
    }
  }
  return { schema: 1, passed: true, evidenceLevel: 'independent-offline-direct-client-archive-review', input: { path: relative(ROOT, input), sha256: sha(raw), bytes: raw.length },
    counts: { messages: seen.size, ed25519Signatures: signatures, callbacks: callbacks.length, paidLicenses: paid.length, rejections: rejected.length,
      unchangedRejectionAccounts: rejected.reduce((n, e) => n + e.unchangedAccounts, 0), exactSignedWires: tickets.length, keylessRecoveryInvocations: recovery.length, loadedElfs: r.loadedPrograms.length, circuits: circuits.length,
      durableAttemptRecords, processCrashWindows: crashChecks.length, readonlyCrashAccounts },
    callbacks, paid, rejected, tickets, recovery, circuits, crashChecks, sharedBoundary, executedClientSources, finalQuota: { version: '2', counter: '6' },
    repeatedQuery: { signature: repeatedSignature, unchangedAccounts: repeatBefore.accounts.length },
    verifierSourceSha256: sha(await readFile(fileURLToPath(import.meta.url))),
    limitations: ['Offline review only; no signer files, runtime changes, network requests or new execution.',
      'SDK plan/instruction/reconciliation validators are independent qualification oracles, not dependencies of the direct application.',
      'Archived RPC account/meta/ALT observations remain trusted; no independent BLS verification or historical consensus proof.',
      'Actual response loss and process IDs are retained local harness evidence, not OS attestations.',
      'Current ELF build bytes match archived loaded reports; raw ProgramData is not independently archived here.',
      ...(crashChecks.length ? ['Retained attempts and selected process-crash windows are checked; arbitrary disk loss, concurrent transport faults and full client failure-mode equivalence are not established.']
        : ['Initial archive does not prove durable broadcast limits, pre-simulation crash recovery or equivalence of untested client failure modes.']),
      'Shares compiler, circuit, on-chain enforcement, native proof bridge and deployment/funding. Full standalone upstream equivalence remains inconclusive.'] };
}

export async function reviewCorruptions(options) {
  const original = await json(options.resultsPath), rejected = [];
  const mutations = [
    ['invalid callback signature', r => { r.callbacks[0].signature = '1'.repeat(88); r.callbacks[0].transaction.transaction.signatures[0] = r.callbacks[0].signature; }],
    ['wrong callback result', r => { r.callbacks[0].output.field1 = !r.callbacks[0].output.field1; }],
    ['wrong retained wire hash', r => { r.tickets[0].wireSha256 = '00'.repeat(32); }],
    ['changed rollback account', r => { r.accountSnapshots.find(s => s.label === 'post-native-rollback-after').accounts.find(a => !a.absent).lamports++; }],
    ['changed paid license', r => { const a = r.accountSnapshots.find(s => s.label === 'a30-payment-after').accounts.find(a => a.owner === r.deployment.programs.license); const bytes = Buffer.from(a.dataBase64, 'base64'); bytes[40] ^= 1; a.dataBase64 = bytes.toString('base64'); }],
    ['different runtime definition', r => { r.circuitArtifacts[0].definition.address = r.deployment.quota; }],
  ];
  if (original.crashWindows) mutations.push(
    ['missing historical crash artifact capture', r => { delete r.crashWindows[0].beforeRecovery; }],
    ['broadcast during read-only crash recovery', r => { r.crashWindows[0].afterReadonlyRecovery.attemptEntries.push('attempt-1.json'); }],
    ['simulation hidden at pre-simulation crash boundary', r => { r.crashWindows.find(c => c.phase === 'after-wire').beforeRecovery.simulation = { value: { err: null } }; }],
  );
  for (const [name, mutate] of mutations) {
    const changed = structuredClone(original); mutate(changed);
    await assert.rejects(reviewDirectArchive({ ...options, resultsOverride: changed }), `Accepted archive corruption: ${name}`); rejected.push(name);
  }
  return { schema: 1, passed: true, classification: 'offline-in-memory-direct-archive-corruption-checks', archiveUnmodified: true, rejected };
}
export function parseArguments(args) {
  const options = {};
  for (let i = 0; i < args.length; i += 2) { const key = args[i]; assert(['--results', '--instance', '--baseline-instance', '--output', '--corruption-output'].includes(key) && args[i + 1] && !args[i + 1].startsWith('--') && !Object.hasOwn(options, key)); options[key] = args[i + 1]; }
  assert(options['--results'] && options['--instance'] && options['--output']);
  return { resultsPath: resolve(options['--results']), instancePath: resolve(options['--instance']), output: resolve(options['--output']),
    ...(options['--baseline-instance'] ? { baselineInstancePath: resolve(options['--baseline-instance']) } : {}),
    ...(options['--corruption-output'] ? { corruptionOutput: resolve(options['--corruption-output']) } : {}) };
}
async function main() {
  const options = parseArguments(process.argv.slice(2)), report = await reviewDirectArchive(options);
  if (options.corruptionOutput) await writeFile(options.corruptionOutput, JSON.stringify(await reviewCorruptions(options), null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await writeFile(options.output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ passed: true, output: options.output, counts: report.counts }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
