#!/usr/bin/env node
/** Offline checks of public retained plans, signed journals and RPC receipts; never opens a signer or sends RPC. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { loadWeb3, REPO } from '../packages/local-client/src/runtime.mjs';
import { validateOperationPlan, descriptorDigest } from '../packages/local-client/src/operation-plan.mjs';
import { validateOperationTicket } from '../packages/local-client/src/operation-ticket.mjs';
import { decodeQuota, INITIAL_PROFILE } from '../packages/sdk/src/index.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = async path => JSON.parse(await readFile(path));
const safeLabel = label => { assert(/^[a-z0-9-]+$/.test(label), 'Unsafe archive label'); return label; };
const bytes = account => { const data = Buffer.from(account.dataBase64, 'base64'); assert.equal(data.toString('base64'), account.dataBase64); return data; };

export function verifyQuerySnapshotRejection(results, plan, web3) {
  const rejection = results.querySnapshotRejection; assert(rejection, 'Snapshot rejection evidence required');
  const descriptor = plan.descriptor;
  assert.deepEqual(rejection.descriptor, descriptor);
  const claim = web3.PublicKey.findProgramAddressSync([Buffer.from('permit-claim'), new web3.PublicKey(descriptor.permit).toBuffer()], new web3.PublicKey(INITIAL_PROFILE.auth))[0].toBase58();
  assert.deepEqual(rejection.trackedAddresses, [descriptor.quota, descriptor.permit, descriptor.job, descriptor.computation, claim]);
  assert.deepEqual(rejection.before.accounts, rejection.after.accounts, 'Rejected query mutated tracked state');
  assert(rejection.before.slot <= rejection.after.slot);
  assert.equal(rejection.before.accounts.length, 5); assert(rejection.before.accounts.slice(2).every(account => account === null));
  const [quotaAccount, permitAccount] = rejection.before.accounts;
  for (const [account, address] of [[quotaAccount, descriptor.quota], [permitAccount, descriptor.permit]]) {
    assert.equal(account.address, address); assert.equal(account.owner, INITIAL_PROFILE.policy); assert.equal(account.executable, false);
  }
  const quotaBytes = bytes(quotaAccount), retainedBytes = Buffer.from(plan.quotaSnapshotHex, 'hex');
  const actual = decodeQuota(quotaBytes), retained = decodeQuota(retainedBytes);
  assert.equal(actual.version, retained.version, 'Test must isolate counter-only drift, not a settled quota version');
  assert.equal(actual.counter, retained.counter + 1n);
  assert(quotaBytes.subarray(0, 88).equals(retainedBytes.subarray(0, 88)), 'Allowance state changed in counter-only test');
  assert(quotaBytes.subarray(96).equals(retainedBytes.subarray(96)), 'Quota authority or route changed');
  assert.equal(bytes(permitAccount).length, 520); assert(bytes(permitAccount).every(value => value === 0));
  const transaction = results.transactions.find(item => item.signature === rejection.signature); assert(transaction);
  assert(rejection.before.slot <= transaction.slot && transaction.slot <= rejection.after.slot, 'Rejected receipt is outside retained snapshot slots');
  assert.deepEqual(transaction.transaction.meta.err, { InstructionError: [1, { Custom: 6004 }] });
  assert(!results.callbacks.some(callback => callback.job === descriptor.job), 'Rejected query unexpectedly has a policy callback');
  assert.equal(rejection.actualCustomError, 6004);
  return { actualCustomError: 6004, signature: rejection.signature, slot: transaction.slot,
    retainedVersion: retained.version.toString(), currentVersion: actual.version.toString(), retainedCounter: retained.counter.toString(), currentCounter: actual.counter.toString(),
    unchangedExistingAccounts: 2, absentJobComputationClaim: 3, callbackForRejectedQuery: false };
}

function receiptMessage(raw, web3) {
  return new web3.MessageV0({ ...raw, staticAccountKeys: raw.staticAccountKeys.map(key => new web3.PublicKey(key)),
    compiledInstructions: raw.compiledInstructions.map(ix => ({ ...ix, data: Buffer.from(ix.data.data ?? Object.values(ix.data)) })),
    addressTableLookups: raw.addressTableLookups.map(lookup => ({ ...lookup, accountKey: new web3.PublicKey(lookup.accountKey) })) });
}

export async function reviewRecoveryArchive({ resultsPath, moduleRoot }) {
  const rawBytes = await readFile(resultsPath), results = JSON.parse(rawBytes), directory = dirname(resolve(resultsPath));
  assert.equal(results.passed, true); assert(results.recoveries?.length > 0, 'No restart evidence');
  const web3 = await loadWeb3(moduleRoot), plans = new Map(), reviewed = new Map();
  const require = createRequire(resolve(moduleRoot, 'package.json')), base58Module = require('bs58'), base58 = base58Module.default ?? base58Module;
  const labels = [...results.operations.map(operation => operation.label), results.querySnapshotRejection.operationLabel];
  for (const label of new Set(labels)) {
    const path = resolve(directory, `operation-${safeLabel(label)}`, 'operation-plan.json'), raw = await readFile(path);
    const plan = validateOperationPlan(JSON.parse(raw)); assert.equal(plan.genesisHash, results.genesis_hash);
    plans.set(plan.descriptor.job, { plan, raw });
  }
  for (const recovery of results.recoveries) {
    safeLabel(recovery.label); assert.equal(recovery.passed, true);
    assert.equal(recovery.generatesKeysProofsOrOperationIdentity, false); assert.equal(recovery.createsNewSignedTransaction, false);
    const archivedWorker = await parse(resolve(directory, `recovery-${recovery.label}.json`));
    const { label, ...embedded } = recovery; assert.deepEqual(archivedWorker, embedded, 'Embedded worker result changed');
    const retained = plans.get(recovery.identity.job); assert(retained, 'Recovery has unknown operation');
    const { plan, raw } = retained;
    assert.equal(recovery.retainedPlan.sha256, sha(raw)); assert.equal(recovery.retainedPlan.bytes, raw.length);
    for (const key of ['job', 'computation', 'permit', 'owner', 'quota', 'effect']) assert.equal(recovery.identity[key], plan.descriptor[key]);
    assert.equal(recovery.genesisHash, results.genesis_hash); assert(recovery.observation.slot >= plan.contextSlot);
    if (recovery.action === 'observe') { assert(!recovery.delivery); continue; }
    const ticketBytes = await readFile(resolve(directory, `recovery-${label}-ticket.json`)), ticket = JSON.parse(ticketBytes);
    assert.equal(recovery.retainedTicket.sha256, sha(ticketBytes)); assert.equal(recovery.retainedTicket.bytes, ticketBytes.length);
    const journal = resolve(ticket.journalDirectory); assert(journal.startsWith(directory + sep), 'Journal outside selected run');
    const manifest = await parse(resolve(journal, 'journal.json'));
    assert.equal(manifest.genesisHash, results.genesis_hash); assert.equal(manifest.maxBroadcasts, 3); assert.equal(manifest.rpcMaxRetries, 5);
    const record = await parse(resolve(journal, `${ticket.signature}.signed.json`));
    assert.equal(record.descriptorSha256, descriptorDigest(plan.descriptor)); assert.equal(record.genesisHash, results.genesis_hash);
    assert.equal(record.signature, ticket.signature); assert.equal(record.wireSha256, ticket.wireSha256);
    assert.equal(recovery.delivery.wireSha256, record.wireSha256); assert.equal(recovery.delivery.signature, record.signature);
    assert.equal(recovery.delivery.role, record.role); assert(recovery.delivery.attempts <= manifest.maxBroadcasts);
    assert.deepEqual(recovery.delivery.retryPolicy, { maxBroadcasts: manifest.maxBroadcasts, rpcMaxRetries: manifest.rpcMaxRetries });
    for (let attempt = 1; attempt <= recovery.delivery.attempts; attempt++) {
      const intent = await parse(resolve(journal, `${ticket.signature}.attempt-${attempt}.json`));
      assert.equal(intent.signature, ticket.signature); assert.equal(intent.wireSha256, record.wireSha256); assert.equal(intent.attempt, attempt); assert.equal(intent.rpcMaxRetries, manifest.rpcMaxRetries);
      const recorded = recovery.delivery.broadcasts[attempt - 1]; assert.equal(recorded.attempt, attempt);
      if (recorded.response) assert.deepEqual(recorded.response, await parse(resolve(journal, `${ticket.signature}.response-${attempt}.json`)));
    }
    if (reviewed.has(ticket.signature)) continue;
    const landed = results.transactions.find(item => item.signature === ticket.signature); assert(landed, 'No final actual receipt for retained ticket');
    const tx = web3.VersionedTransaction.deserialize(Buffer.from(record.wireBase64, 'base64'));
    const actualMessage = receiptMessage(landed.transaction.transaction.message, web3);
    assert(Buffer.from(actualMessage.serialize()).equals(Buffer.from(tx.message.serialize())), 'Actual receipt differs from signed wire');
    assert.deepEqual(landed.transaction.transaction.signatures, tx.signatures.map(signature => base58.encode(signature)), 'Actual receipt signatures differ from retained signed wire');
    assert.equal(landed.transaction.transaction.signatures[0], ticket.signature);
    // Reconstruct only the lookup entries actually resolved by the archived receipt.
    // This is an offline crosscheck, explicitly not a fresh live ALT read.
    const loaded = landed.transaction.meta.loadedAddresses ?? { writable: [], readonly: [] };
    assert.deepEqual(loaded, record.loadedAddresses);
    const tables = new Map(); let writable = 0, readonly = 0;
    for (const lookup of tx.message.addressTableLookups) {
      const addresses = [];
      for (const index of lookup.writableIndexes) addresses[index] = new web3.PublicKey(loaded.writable[writable++]);
      for (const index of lookup.readonlyIndexes) addresses[index] = new web3.PublicKey(loaded.readonly[readonly++]);
      tables.set(lookup.accountKey.toBase58(), { context: { slot: landed.slot }, value: { key: lookup.accountKey, state: { addresses } } });
    }
    const binding = await validateOperationTicket(plan, record, web3, { getAddressLookupTable: async key => { assert(tables.has(key.toBase58())); return tables.get(key.toBase58()); } });
    reviewed.set(ticket.signature, { signature: ticket.signature, role: record.role, wireSha256: record.wireSha256, descriptorSha256: binding.descriptorSha256,
      receiptSlot: landed.slot, receiptError: landed.error, lookupEvidence: 'archived receipt resolution, not a live reread' });
  }
  const rejectionPlan = [...plans.values()].find(({ plan }) => plan.label === results.querySnapshotRejection.operationLabel)?.plan; assert(rejectionPlan);
  const rejection = verifyQuerySnapshotRejection(results, rejectionPlan, web3);
  return { schema: 1, passed: true, evidenceLevel: 'offline-recovery-journal-and-receipt-crosscheck', genesisHash: results.genesis_hash,
    input: { path: relative(REPO, resolve(resultsPath)), bytes: rawBytes.length, sha256: sha(rawBytes) },
    counts: { workers: results.recoveries.length, distinctRecordedProcessIds: new Set(results.recoveries.map(value => value.processId)).size, signedTickets: reviewed.size },
    tickets: [...reviewed.values()], querySnapshotRejection: rejection,
    limitations: ['No RPC calls, public-network writes, key access or fresh execution; trusted archived RPC receipts are not historical state proofs.',
      'Signed wire semantics reuse the operation-ticket validator; signature checks use Node Ed25519. This does not independently verify BLS or reconstruct runtime execution.',
      'Process IDs and test response-loss classifications are archived runner evidence, not independent operating-system attestations.'] };
}

async function main() {
  const args = process.argv.slice(2), options = {};
  for (let i = 0; i < args.length; i += 2) {
    assert(['--results', '--module-root', '--output'].includes(args[i]) && args[i + 1] && !(args[i] in options), 'Expected unique --results --module-root --output'); options[args[i]] = args[i + 1];
  }
  assert(options['--results'] && options['--module-root'] && options['--output']);
  const report = await reviewRecoveryArchive({ resultsPath: options['--results'], moduleRoot: options['--module-root'] });
  await writeFile(options['--output'], JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ passed: true, output: options['--output'], counts: report.counts }));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error); process.exitCode = 1; });
