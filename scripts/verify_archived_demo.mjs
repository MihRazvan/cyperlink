#!/usr/bin/env node
// Offline evidence review: this never connects to RPC or changes a ledger.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { createHash, verify } from 'node:crypto';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const flags = new Map([['--results','results'],['--public-report','publicReport'],['--source-manifest','sourceManifest'],['--module-root','moduleRoot'],['--output','output']]);
const options = {};
for (let i = 2; i < process.argv.length; i += 2) {
  const name = flags.get(process.argv[i]); assert(name && !options[name] && process.argv[i + 1], 'Expected unique option/value pairs'); options[name] = resolve(process.argv[i + 1]);
}
for (const name of flags.values()) assert(options[name], `Missing ${name}`);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const parse = async path => JSON.parse(await readFile(path, 'utf8'));
const raw = await readFile(options.results), results = JSON.parse(raw), report = await parse(options.publicReport), sources = await parse(options.sourceManifest);
assert.equal(results.scenario, 'conflict', 'This verifier currently qualifies the conflict scenario only');
assert.equal(results.passed, true); assert.equal(report.passed, true);
assert.equal(report.full_evidence.sha256, sha(raw)); assert.equal(report.full_evidence.bytes, raw.length);
for (const [publicKey, rawKey] of [['genesis_hash','genesis_hash'],['scenario','scenario'],['operations','operations'],['final_quota','finalQuota'],['observer_disclosures','observer_disclosures'],['validator_cost_by_category','validatorCostByCategory']]) assert.deepEqual(report[publicKey], results[rawKey], publicKey);
assert.deepEqual(report.checks, results.checks.map(({ logs, ...rest }) => rest));
assert.deepEqual(report.compiled_program_source_manifest, sources);

const require = createRequire(resolve(options.moduleRoot, 'package.json'));
const web3 = require('@solana/web3.js'); assert.equal(require('@solana/web3.js/package.json').version, '1.99.0');
const anchor = require('@anchor-lang/core'); const base58 = require('bs58'); const decode = (base58.default ?? base58).decode;
let signaturesVerified = 0;
const all = [...results.transactions, ...results.callbacks];
for (const entry of all) {
  const tx = entry.transaction.transaction, rawMessage = tx.message;
  const message = rawMessage.staticAccountKeys ? new web3.MessageV0({ ...rawMessage,
    staticAccountKeys: rawMessage.staticAccountKeys.map(key => new web3.PublicKey(key)),
    compiledInstructions: rawMessage.compiledInstructions.map(ix => ({ ...ix, data: Buffer.from(ix.data.data ?? Object.values(ix.data)) })),
    addressTableLookups: rawMessage.addressTableLookups.map(lookup => ({ ...lookup, accountKey: new web3.PublicKey(lookup.accountKey) })),
  }) : new web3.Message({ ...rawMessage, accountKeys: rawMessage.accountKeys.map(key => new web3.PublicKey(key)) });
  const keys = rawMessage.staticAccountKeys ?? rawMessage.accountKeys;
  for (let i = 0; i < rawMessage.header.numRequiredSignatures; i++) {
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), new web3.PublicKey(keys[i]).toBuffer()]);
    assert(verify(null, message.serialize(), { key: spki, format: 'der', type: 'spki' }, decode(tx.signatures[i])), `Invalid signature: ${entry.label}`);
    signaturesVerified++;
  }
  assert.equal(entry.signature, tx.signatures[0]);
}
const indexed = new Map(results.transactions.map(entry => [entry.signature, entry]));
for (const critical of report.critical_transactions) {
  const full = indexed.get(critical.signature); assert(full);
  for (const [key, value] of Object.entries(critical)) if (key in full) assert.deepEqual(full[key], value, `${critical.label}:${key}`);
}
for (const entry of results.loaded_programs) {
  assert(entry.matched); assert.equal(entry.genesis_hash, results.genesis_hash);
  assert.equal(sha(await readFile(entry.local_elf_path)), entry.elf_sha256);
  assert.equal(entry.elf_sha256, entry.loaded_elf_sha256);
}
for (const [path, digest] of Object.entries(sources.files)) assert.equal(sha(await readFile(resolve(root, path))), digest, `Compiled source ${path}`);
for (const entry of report.executed_client_source_manifest) {
  const bytes = await readFile(resolve(dirname(options.results), 'executed-client-source', entry.path));
  assert.equal(sha(bytes), entry.sha256); assert.equal(bytes.length, entry.bytes);
}

const auth = results.loaded_programs.find(entry => entry.program === '5bgSoi3WbUndQNhWrkxJoURjkRd28BxxucZozwGR9AQQ');
const idlPath = resolve(dirname(auth.local_elf_path), '../idl/cyperlink_auth.json'); const idlBytes = await readFile(idlPath);
assert.equal(sha(idlBytes), results.idl_sha256); const idl = JSON.parse(idlBytes); const coder = new anchor.BorshInstructionCoder(idl);
for (const callback of results.callbacks) {
  const message = callback.transaction.transaction.message;
  const instruction = message.compiledInstructions.find(ix => message.staticAccountKeys[ix.programIdIndex] === idl.address); assert(instruction);
  const decoded = coder.decode(Buffer.from(instruction.data.data));
  const output = Object.fromEntries(Object.entries(decoded.data.output.Success[0]).map(([key,value]) => [key.replace('_',''), value]));
  assert.deepEqual(output, callback.output); assert.equal(callback.transaction.meta.err, null);
  const keys = instruction.accountKeyIndexes.map(index => message.staticAccountKeys[index]); assert(keys.includes(callback.job)); assert(keys.includes(callback.computation));
}
for (const operation of results.operations) {
  const prepared = await parse(resolve(dirname(options.results), `operation-${operation.label}/prepared-transfer.json`));
  const callback = results.callbacks.find(entry => entry.job === operation.job); assert(callback);
  assert.equal(Buffer.from(callback.output.field0).toString('hex'), prepared.expected_commitment); assert.equal(callback.status, operation.status);
}
assert.equal(sha(Buffer.from(results.finalQuota.nonce + results.finalQuota.ciphertext, 'hex')), results.finalQuota.stateHash);
const rejections = [];
if (results.scenario === 'conflict') {
  const expected = { 'changed-destination-binding-rejected': 705, 'changed-application-action-binding-rejected': 705,
    'changed-consumer-binding-rejected': 705, 'post-native-transfer-merchant-failure-rolls-back': 1099,
    'competing-license-stale-authorization': 803, 'consumed-merchant-entitlement-replay': 1001 };
  for (const [label, code] of Object.entries(expected)) {
    const entry = results.transactions.find(tx => tx.label === label); assert(entry);
    assert.deepEqual(entry.transaction.meta.err, { InstructionError: [1, { Custom: code }] });
    if (code === 1099) assert(entry.transaction.meta.logMessages.some(line => line === 'Program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb success'));
    rejections.push({ label, signature: entry.signature, slot: entry.slot, customError: code });
  }
  assert.deepEqual(results.callbacks.slice(1).map(entry => entry.output.field1), [true, true, false]);
  assert.deepEqual(results.callbacks.slice(1).map(entry => entry.status), [1, 1, 2]);
  assert.equal(results.finalQuota.version, '1'); assert.equal(results.finalQuota.counter, '4');
  assert.equal(Buffer.from(results.callbacks[1].output.field2).toString('hex'), results.finalQuota.ciphertext);
}
const review = {
  schema_version: 1, passed: true, classification: 'independent-agent-offline-archive-verification',
  checked_at: new Date().toISOString(), scenario: results.scenario, genesis_hash: results.genesis_hash,
  inputs: Object.fromEntries(await Promise.all(['results','publicReport','sourceManifest'].map(async name => [name, { path: relative(root, options[name]), sha256: sha(await readFile(options[name])) }]))),
  counts: { archivedTransactions: all.length, ed25519SignaturesVerified: signaturesVerified, callbackPayloadsDecoded: results.callbacks.length,
    criticalPublicEntriesMatched: report.critical_transactions.length, localElfFilesMatchedToRecordedLoadedHashes: results.loaded_programs.length,
    compiledSourceFilesMatched: Object.keys(sources.files).length, archivedClientSourceFilesMatched: report.executed_client_source_manifest.length },
  actualFailedTransactionReceipts: rejections,
  callbackDecisions: results.callbacks.slice(1).map(entry => ({ job: entry.job, allow: entry.output.field1, status: entry.status })),
  finalQuota: results.finalQuota,
  limitations: [
    'Offline verification of retained RPC receipts, signed messages and source/artifact hashes; no fresh RPC reread of the replaced v4 ledger.',
    'Ed25519 transaction signatures were independently checked. BLS output authenticity is supported by successful onchain callback verification and matched program artifacts, not a separate offline BLS verifier.',
    'Rollback byte equality was asserted by the executed runner before and after each failure. Those raw historical snapshots were not retained for v4; this review does not independently revalidate historical rollback account bytes.',
    'Native success log followed by consumer1099 confirms the late failure path in its failed transaction receipt. It does not itself expose confidential balances.',
    'Conflict scenario proves merchant settlement and license admission/staleness/fresh denial. Successful license settlement is a separate compatible-scenario result.',
    'No production security audit, public-network execution or external integration claim.'
  ],
};
await writeFile(options.output, JSON.stringify(review, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ passed: true, output: options.output, counts: review.counts }));
