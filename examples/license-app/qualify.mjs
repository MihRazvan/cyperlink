#!/usr/bin/env node
/** Internal real-local rehearsal. Fault injection and observer values are explicit. */
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPrivateRun, loadSigner, REPO, TOKEN_PROGRAM } from '../../packages/local-client/src/runtime.mjs';
import { validateOperation, decodeQuota } from '../../packages/policy-client/src/sdk.mjs';
import { DurableTransactionSender } from '../../packages/local-client/src/durable-transaction.mjs';
import { validateOperationTicket } from '../../packages/policy-client/src/operation-ticket.mjs';
import { json, writeJson, sha, snapshot, unchanged, businessState, callback, sleep } from '../policies/qualification/evidence.mjs';
import { signedMessage, verifyPaidTransition, verifyRollback } from '../policies/qualification/archive.mjs';

const execute = promisify(execFile);
const [instancePath, output] = process.argv.slice(2);
assert(instancePath && output, 'Usage: node examples/license-app/qualify.mjs INSTANCE NEW_OUTPUT');
const instance = await json(instancePath), directory = await createPrivateRun(output);
const result = { schema: 1, passed: false, classification: 'internal-docs-first-app-real-local-qualification',
  genesisHash: instance.descriptor.genesisHash, deployment: instance.descriptor, instancePath: resolve(instancePath),
  observerDisclosures: { initialState: { remaining: 50, purchase_cap: 30 }, amounts: [40, 30, 30, 30, 20],
    note: 'Synthetic fixture values and arithmetic inferences; no live MXE state decryption.' },
  appInvocations: [], transactions: [], callbacks: [], accountSnapshots: [], operations: [], checks: [], loadedPrograms: [],
  limitations: ['Internal author with recorded SDK source assistance; not external adoption',
    'Same host/cached prerequisites/two local nodes; not independent operators or blank-machine bootstrap',
    'Explicit local SBPFv0 deployment feature override; no public-network or production claim',
    'RPC faults injected by a qualification-only preload; actual payments still execute on the validator',
    'Confirmed RPC receipts/snapshots, not historical consensus proofs; BLS verified by loaded runtime, not a new offline verifier'] };
const save = () => writeJson(resolve(directory, 'results.json'), result);
await save();
try {
  const bindings = await import(pathToFileURL(resolve(instance.releaseDirectory, '../../bindings.mjs')));
  const client = await bindings.connect({ deployment: instance.descriptor, endpoint: instance.endpoint,
    moduleRoot: instance.moduleRoot, payerKeyfile: instance.payerKeyfile, idl: instance.idl, proofCli: instance.proofCli,
    directory: await createPrivateRun(resolve(directory, 'observer-and-adversarial-client')),
    record: async receipt => { result.transactions.push(receipt); await save(); } });
  await client.assertDeploymentState();
  const { connection, web3 } = client.session, { PublicKey, TransactionInstruction } = web3;
  const deployment = await json(instance.results);
  assert(deployment.passed);
  for (const [index, program] of deployment.loadedPrograms.entries()) {
    const out = resolve(directory, `loaded-${index}.json`);
    await execute('python3', [resolve(REPO, 'scripts/verify_loaded_program.py'), '--program-id', program.program,
      '--elf', program.local_elf_path, '--rpc', instance.endpoint, '--output', out]);
    const verified = await json(out); assert(verified.matched); assert.equal(verified.genesis_hash, result.genesisHash);
    result.loadedPrograms.push(verified);
  }
  assert.equal(result.loadedPrograms.length, 10); await save();
  assert.equal(decodeQuota((await connection.getAccountInfo(client.Q)).data).version, 0n);
  let invocation = 0;
  async function app(command, op, extra = [], fault) {
    const args = [resolve(REPO, 'examples/license-app/app.mjs'), command, '--instance', resolve(instancePath), '--operation', op.directory, ...extra];
    if (['prepare', 'approve-query', 'approve-payment'].includes(command)) args.push('--admin-keyfile', instance.payerKeyfile, '--owner-keyfile', op.ownerPath);
    const started = Date.now(), id = invocation++;
    let stdout, stderr, code = 0;
    try { ({ stdout, stderr } = await execute(process.execPath, args,
      { maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...(fault ? { CYPERLINK_TEST_RPC_FAULT_FILE: fault,
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --import=${pathToFileURL(resolve(REPO, 'examples/license-app/rpc-fault.mjs')).href}` } : {}) } })); }
    catch (error) { stdout = error.stdout ?? ''; stderr = error.stderr ?? ''; code = error.code; }
    await writeJson(resolve(directory, `invocation-${id}.json`), { args, stdout, stderr, code });
    let summary;
    if (code === 0) summary = JSON.parse(stdout.slice(stdout.lastIndexOf('\n{') + 1));
    else { const lines = stderr.trim().split('\n'); summary = JSON.parse(lines.at(-1)); }
    result.appInvocations.push({ id, command, label: op.label, exitCode: code, elapsedMs: Date.now() - started, faultInjected: Boolean(fault), summary }); await save();
    if (!fault) assert.equal(code, 0, stderr); else { assert.notEqual(code, 0); assert.equal(summary.paymentCommitted, false); }
    return summary;
  }
  async function prepare(label, amount, source = 'license') {
    const provisionedDirectory = instance.assetDirectories[source];
    const op = { label, directory: resolve(directory, 'operation-' + label), amount, consumer: 'license',
      ownerPath: resolve(provisionedDirectory, 'source-owner-signer.json') };
    const expiry = String((await connection.getSlot('confirmed')) + 950);
    await app('prepare', op, ['--label', label, '--amount', String(amount), '--product', sha(Buffer.from(label)).toString('hex'), '--expiry-slot', expiry,
      '--provisioned-directory', provisionedDirectory]);
    op.plan = await json(resolve(op.directory, 'operation-plan.json'));
    result.operations.push({ label, amountObserverDisclosure: amount, planPath: resolve(op.directory, 'operation-plan.json'), descriptor: op.plan.descriptor }); await save();
    return op;
  }
  function tracked(op) {
    const d = op.plan.descriptor, t = validateOperation(d).template;
    return [t.source, t.destination, t.mint, ...op.plan.binding.proofAddresses, d.quota, d.permit, d.effect, d.job, d.computation, op.plan.action].map(x => new PublicKey(x));
  }
  const snap = (op, label) => snapshot(connection, tracked(op), label, result, save);
  async function admit(op, allowed) {
    const before = await snap(op, `${op.label}-query-before`), started = Date.now();
    await app('approve-query', op);
    const cb = await callback(client, op, allowed ? 1 : 2, started, result, save);
    assert.equal(cb.result.output.field1, allowed);
    assert(Buffer.from(cb.result.output.field0).equals(validateOperation(op.plan.descriptor).template.amountCommitment));
    const after = await snap(op, `${op.label}-callback-after`);
    const q = s => Buffer.from(s.accounts.find(a => a.address === op.plan.descriptor.quota).dataBase64, 'base64');
    assert(businessState(q(before)).equals(businessState(q(after))));
    const observation = await app('observe', op);
    assert.equal(observation.status, allowed ? 'authorized' : 'denied'); assert.equal(observation.paymentCommitted, false);
    if (allowed) {
      const permit = Buffer.from(after.accounts.find(a => a.address === op.plan.descriptor.permit).dataBase64, 'base64');
      const output = cb.result.output.field2;
      assert(permit.subarray(480, 512).equals(Buffer.from(output[0])));
      assert(permit.subarray(520, 616).equals(Buffer.concat(output.slice(1).map(x => Buffer.from(x)))));
    }
    result.checks.push({ label: `${op.label}-authenticated-decision`, allowed, callbackDoesNotPayOrAdvanceState: true }); await save();
    return op;
  }
  async function rejection(op, label, expectedError, fault = false) {
    const raw = op.plan.instructions.commit;
    const ix = new TransactionInstruction({ programId: new PublicKey(raw.program), data: Buffer.from(raw.data, 'hex'),
      keys: raw.accounts.map(a => ({ pubkey: new PublicKey(a.key), isSigner: a.signer, isWritable: a.writable })) });
    if (fault) ix.data[41] = 1; // Existing qualification-only license fault, after native CPI.
    const before = await snap(op, label + '-before');
    const receipt = await client.transport.send(label, [ix], [await loadSigner(op.ownerPath, web3)], { expectedError, category: 'adversarial-landed-failure' });
    const after = await snap(op, label + '-after'); unchanged(before, after);
    if (fault) assert(receipt.transaction.meta.logMessages.some(s => s.includes('ConfidentialTransferInstruction::Transfer')));
    const accountsChecked = verifyRollback(before, after, receipt);
    result.checks.push({ label, expectedError, signature: receipt.signature, accountsChecked, postNativeCpi: fault }); await save();
  }
  async function paid(op, lostAck) {
    const before = await snap(op, op.label + '-payment-before');
    await app('approve-payment', op, ['--submit', 'no']);
    const ticketPath = resolve(op.directory, 'commit-ticket.json'), ticket = await json(ticketPath);
    const ticketHash = sha(await readFile(ticketPath)).toString('hex');
    const journal = await DurableTransactionSender.open({ web3, connection, endpoint: instance.endpoint, directory: ticket.journalDirectory });
    const retained = await journal.read(ticket);
    if (lostAck) {
      for (const mode of ['lost-ack', 'unavailable-receipt']) {
        const config = resolve(directory, mode + '.json');
        await writeJson(config, { mode, endpoint: instance.endpoint, signature: ticket.signature, wireSha256: retained.record.wireSha256, log: resolve(directory, mode + '.ndjson') });
        await app(mode === 'lost-ack' ? 'approve-payment' : 'recover', op, mode === 'lost-ack' ? [] : ['--role', 'commit'], config);
        const events = (await readFile(resolve(directory, mode + '.ndjson'), 'utf8')).trim().split('\n').map(JSON.parse);
        const sends = events.filter(e => e.fault === 'actual-send-response-lost');
        assert.equal(sends.length, mode === 'lost-ack' ? 1 : 0);
        if (sends.length) { assert.equal(sends[0].signature, ticket.signature); assert.equal(sends[0].wireSha256, retained.record.wireSha256); }
        assert(events.some(e => e.fault === 'receipt-unavailable'));
        (result.injectedFaults ??= []).push({ mode, events }); await save();
      }
      assert.equal(sha(await readFile(ticketPath)).toString('hex'), ticketHash);
    } else await app('approve-payment', op);
    let observed;
    for (let i = 0; i < 20; i++) { observed = await app('recover', op, ['--role', 'commit']); if (observed.paymentCommitted) break; await sleep(250); }
    assert.equal(observed.status, 'committed');
    const recovery = await json(observed.report);
    assert.equal(recovery.createsNewSignedTransaction, false); assert.equal(recovery.generatesKeysProofsOrOperationIdentity, false);
    assert.equal(recovery.delivery.signature, ticket.signature); assert.equal(recovery.delivery.wireSha256, retained.record.wireSha256);
    assert.equal(sha(await readFile(ticketPath)).toString('hex'), ticketHash);
    const tx = await connection.getTransaction(ticket.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
    const entry = { label: op.label + '-payment', category: 'native-settlement', signature: ticket.signature, slot: tx.slot,
      transaction: tx, landedCU: tx.meta.computeUnitsConsumed, feeLamports: tx.meta.fee };
    result.transactions.push(entry);
    const after = await snap(op, op.label + '-payment-after');
    const checked = verifyPaidTransition(before, after, entry, { descriptor: op.plan.descriptor });
    for (const address of [validateOperation(op.plan.descriptor).template.source, validateOperation(op.plan.descriptor).template.destination]) {
      assert.equal(checked.before.get(address).owner, TOKEN_PROGRAM);
      assert(!checked.before.get(address).data.equals(checked.after.get(address).data));
    }
    assert(checked.effect.subarray(8, 40).equals(new PublicKey(op.plan.descriptor.owner).toBuffer()));
    assert.equal(checked.effect.subarray(40, 72).toString('hex'), op.plan.descriptor.productHex32);
    assert.equal(checked.effect.readBigUInt64LE(72).toString(), op.plan.descriptor.licenseExpirySlot);
    assert(tx.meta.logMessages.includes(`Program ${TOKEN_PROGRAM} success`));
    result.checks.push({ label: op.label + '-paid-license', signature: ticket.signature, wireSha256: retained.record.wireSha256,
      lostAcknowledgement: lostAck, keylessWorker: recovery.processId, exactFourSlotSuccessor: true, oneRetainedPaymentTicket: true }); await save();
  }
  await admit(await prepare('cap-rejects-funded40', 40), false);
  const a = await admit(await prepare('purchase-a30', 30), true);
  const repeatedBefore = await snap(a, 'repeat-query-before');
  await app('approve-query', a);
  unchanged(repeatedBefore, await snap(a, 'repeat-query-after'));
  result.checks.push({ label: 'repeated-query-approval-reuses-ticket', allTrackedAccountsUnchanged: true }); await save();
  // Distinct native sources isolate shared-policy staleness from source-balance staleness.
  const b = await admit(await prepare('competing-b30', 30, 'merchant'), true);
  await rejection(a, 'license-post-native-failure', 1199, true);
  await paid(a, true);
  assert.equal((await app('observe', b)).status, 'stale');
  await rejection(b, 'stale-predecessor-cannot-pay', 803);
  await rejection(a, 'issued-license-cannot-pay-twice', 1102);
  await admit(await prepare('fresh-b30-allocation-denial', 30, 'merchant'), false);
  const compatible = await admit(await prepare('fresh-compatible20', 20, 'merchant'), true);
  await paid(compatible, false);
  const final = await connection.getAccountInfoAndContext(client.Q, { commitment: 'confirmed' });
  assert.equal(decodeQuota(final.value.data).version, 2n);
  result.finalState = { slot: final.context.slot, quota: client.Q.toBase58(), dataBase64: final.value.data.toString('base64') };
  // Independently verify the archived transaction signatures, not merely SDK log labels.
  result.tickets = [];
  for (const op of result.operations) for (const role of ['query', 'commit']) {
    let ticket;
    try { ticket = await json(resolve(dirname(op.planPath), `${role}-ticket.json`)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const plan = await json(op.planPath);
    const sender = await DurableTransactionSender.open({ web3, connection, endpoint: instance.endpoint, directory: ticket.journalDirectory });
    const retained = await sender.read(ticket), delivered = await sender.recover(ticket);
    assert.equal(delivered.status, 'landed');
    const semanticBinding = await validateOperationTicket(plan, retained.record, web3, connection);
    assert(Buffer.from(delivered.receipt.transaction.message.serialize()).equals(retained.message));
    result.tickets.push({ label: op.label, role, signature: ticket.signature, wireSha256: ticket.wireSha256,
      semanticBinding, exactLandedMessage: true, broadcasts: delivered.attempts });
    if (!result.transactions.some(t => t.signature === ticket.signature)) result.transactions.push({ label: op.label + '-' + role,
      category: role === 'query' ? 'arcium-queue' : 'native-settlement', signature: ticket.signature, slot: delivered.receipt.slot,
      transaction: delivered.receipt, landedCU: delivered.receipt.meta.computeUnitsConsumed, feeLamports: delivered.receipt.meta.fee });
  }
  assert.equal(result.tickets.length, 7);
  result.circuitArtifacts = [];
  for (const name of ['runtime_policy_init', 'runtime_policy_evaluate']) result.circuitArtifacts.push(await json(resolve(dirname(instancePath), name + '-uploaded-evidence.json')));
  const require = createRequire(resolve(instance.moduleRoot, 'package.json')), base58Module = require('bs58'), base58 = base58Module.default ?? base58Module;
  const seen = new Set(); let signatures = 0;
  for (const entry of [...result.transactions, ...result.callbacks]) {
    if (seen.has(entry.signature)) continue; seen.add(entry.signature);
    signatures += signedMessage(JSON.parse(JSON.stringify(entry)), web3, base58).signatures;
  }
  result.signedArchiveChecks = { messages: seen.size, ed25519Signatures: signatures, excludesProvisioningAndDeploymentReceipts: true };
  assert.equal(result.callbacks.length, 5); assert.equal(result.checks.filter(c => c.exactFourSlotSuccessor).length, 2);
  result.passed = true; await save();
  console.log(JSON.stringify({ passed: true, results: resolve(directory, 'results.json'), callbacks: 5, paidLicenses: 2 }));
} catch (error) { result.error = error.stack; await save(); throw error; }
