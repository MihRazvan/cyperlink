// Offline retained-RPC snapshot consistency checks. No RPC or file writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { INITIAL_PROFILE as P, publicKeyBytes } from '../packages/sdk/src/index.mjs';
const TOKEN = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const failures = {
  'changed-destination-binding-rejected': 705,
  'changed-application-action-binding-rejected': 705,
  'changed-consumer-binding-rejected': 705,
  'post-native-transfer-merchant-failure-rolls-back': 1099,
  'competing-license-stale-authorization': 803,
  'consumed-merchant-entitlement-replay': 1001,
};
const sha = bytes => createHash('sha256').update(bytes).digest();
const allZero = bytes => bytes.every(byte => byte === 0);

function instruction(entry) {
  const receipt = entry.transaction;
  assert.equal(entry.slot, receipt.slot, 'Receipt slot disagrees with entry');
  const message = receipt.transaction.message;
  const keys = message.staticAccountKeys ? [...message.staticAccountKeys,
    ...(receipt.meta.loadedAddresses?.writable ?? []), ...(receipt.meta.loadedAddresses?.readonly ?? [])] : message.accountKeys;
  assert(Array.isArray(keys)); keys.forEach(publicKeyBytes);
  const matches = (message.compiledInstructions ?? message.instructions).filter(ix => [P.merchant, P.license].includes(keys[ix.programIdIndex]));
  assert.equal(matches.length, 1, 'Expected exactly one consumer instruction');
  const ix = matches[0];
  assert(Array.isArray(ix.accountKeyIndexes), 'Expected retained versioned consumer instruction');
  assert.equal(ix.accountKeyIndexes.length, 17, 'Unexpected consumer instruction account count');
  const accounts = ix.accountKeyIndexes.map(index => { assert(Number.isInteger(index) && index >= 0 && index < keys.length); return keys[index]; });
  let raw = ix.data;
  if (raw?.type === 'Buffer') raw = raw.data;
  else if (raw && !Array.isArray(raw) && typeof raw === 'object') raw = Object.values(raw);
  assert(Array.isArray(raw) && raw.every(value => Number.isInteger(value) && value >= 0 && value <= 255), 'Malformed retained consumer instruction bytes');
  const data = Buffer.from(raw), program = keys[ix.programIdIndex];
  assert(data.length >= (program === P.merchant ? 10 : 42));
  assert.equal(data[0], program === P.merchant ? 1 : 2, 'Unexpected consumer instruction variant');
  assert.equal(accounts[1], P.quota); assert.equal(accounts[13], program);
  return { program, accounts, data };
}
function decodeSnapshot(snapshot) {
  assert.equal(snapshot.commitment, 'confirmed', 'Snapshot commitment differs from executed demo profile');
  assert(Number.isSafeInteger(snapshot.context?.slot) && snapshot.context.slot >= 0, 'Invalid snapshot slot');
  assert(Array.isArray(snapshot.accounts) && snapshot.accounts.length > 0, 'Missing raw account snapshot');
  const accounts = new Map();
  for (const account of snapshot.accounts) {
    publicKeyBytes(account.address); publicKeyBytes(account.owner);
    assert(!accounts.has(account.address), 'Duplicate account in snapshot');
    assert.equal(account.executable, false, 'Tracked state account must not be executable');
    assert(Number.isSafeInteger(account.lamports) && account.lamports >= 0, 'Invalid snapshot lamports');
    assert.equal(typeof account.dataBase64, 'string');
    const data = Buffer.from(account.dataBase64, 'base64');
    assert.equal(data.toString('base64'), account.dataBase64, 'Noncanonical account base64');
    accounts.set(account.address, { ...account, data });
  }
  return accounts;
}
function originalOperation(results, ix) {
  const matches = results.operations.filter(op => op.permit === ix.accounts[0]);
  assert.equal(matches.length, 1, 'Consumer permit must identify one retained operation');
  const operation = matches[0];
  assert.equal(operation.source, ix.accounts[5], 'Consumer source differs from retained operation');
  return operation;
}
function expectedAccounts(operation, ix) {
  const roles = new Map();
  function add(address, owner, size) {
    const existing = roles.get(address);
    if (existing) assert.deepEqual(existing, { owner, size }, 'Aliased incompatible tracked roles');
    roles.set(address, { owner, size });
  }
  add(operation.source, TOKEN, 470); add(operation.destination, TOKEN, 470);
  add(operation.permit, P.policy, 520); add(P.quota, P.policy, 161);
  add(operation.record, operation.consumer, operation.kind === 'merchant' ? 49 : 81);
  add(ix.accounts[7], TOKEN, 470); add(ix.accounts[16], ix.program, ix.program === P.merchant ? 49 : 81);
  return roles;
}
function pair(results, byLabel, base, entry, operation, ix) {
  const beforeRaw = byLabel.get(base + '-before'), afterRaw = byLabel.get(base + '-after');
  assert(beforeRaw && afterRaw, `Missing before/after snapshots for ${base}`);
  assert(beforeRaw.context.slot <= entry.slot && entry.slot <= afterRaw.context.slot, 'Snapshots do not bracket the recorded transaction slot');
  const before = decodeSnapshot(beforeRaw), after = decodeSnapshot(afterRaw), expected = expectedAccounts(operation, ix);
  for (const actual of [before, after]) {
    assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort(), 'Tracked account set differs from operation/consumer transaction');
    for (const [address, role] of expected) {
      assert.equal(actual.get(address).owner, role.owner, `Unexpected state owner for ${address}`);
      assert.equal(actual.get(address).data.length, role.size, `Unexpected account size for ${address}`);
    }
    assert(allZero(actual.get(P.quota).data.subarray(129)), 'Transient active permit survived transaction boundary');
    const q = actual.get(P.quota).data;
    assert.equal(q[128], 1); assert(sha(q.subarray(40, 88)).equals(q.subarray(8, 40)), 'Quota ciphertext/hash mismatch');
  }
  return { before, after, beforeSlot: beforeRaw.context.slot, transactionSlot: entry.slot, afterSlot: afterRaw.context.slot };
}
export function verifyAccountSnapshots(results, { required = false } = {}) {
  if (results.accountSnapshots === undefined) {
    assert(!required, 'Raw account snapshots are required for this review');
    return { available: false, reason: 'This historical archive did not retain raw before/after account snapshots' };
  }
  assert(['conflict', 'compatible'].includes(results.scenario), 'Unsupported snapshot scenario');
  assert(Array.isArray(results.accountSnapshots) && results.accountSnapshots.length > 0);
  const byLabel = new Map(); let lastSlot = -1;
  for (const snapshot of results.accountSnapshots) {
    assert(typeof snapshot.label === 'string' && !byLabel.has(snapshot.label), 'Duplicate or invalid snapshot label');
    decodeSnapshot(snapshot);
    assert(snapshot.context.slot >= lastSlot, 'Snapshot slots regress in capture order'); lastSlot = snapshot.context.slot;
    byLabel.set(snapshot.label, snapshot);
  }
  const find = label => {
    const matches = results.transactions.filter(tx => tx.label === label); assert.equal(matches.length, 1, `Missing/duplicate transaction ${label}`); return matches[0];
  };
  const comparisons = [], consumedLabels = new Set();
  for (const [label, code] of Object.entries(results.scenario === 'conflict' ? failures : {})) {
    const entry = find(label), ix = instruction(entry), operation = originalOperation(results, ix);
    assert.deepEqual(entry.transaction.meta.err, { InstructionError: [1, { Custom: code }] });
    if (code === 1099) assert(entry.transaction.meta.logMessages.includes(`Program ${TOKEN} success`), 'Late rollback receipt lacks successful native transfer invocation');
    const checked = pair(results, byLabel, label, entry, operation, ix);
    for (const [address, before] of checked.before) {
      const after = checked.after.get(address);
      assert.deepEqual(after, before, `Rejected effect changed retained account data/metadata: ${label}:${address}`);
    }
    comparisons.push({ label, signature: entry.signature, errorCode: code, accountsCompared: checked.before.size,
      beforeSlot: checked.beforeSlot, transactionSlot: checked.transactionSlot, afterSlot: checked.afterSlot,
      equalFields: ['dataBytes', 'owner', 'executable', 'lamports'] });
    consumedLabels.add(label + '-before'); consumedLabels.add(label + '-after');
  }
  const commits = [];
  for (const operation of results.operations) {
    if (!byLabel.has(operation.label + '-commit-before')) continue;
    const label = operation.label + '-atomic-paid-entitlement', entry = find(label), ix = instruction(entry);
    assert.equal(entry.transaction.meta.err, null);
    assert.equal(originalOperation(results, ix), operation);
    assert.equal(ix.accounts[7], operation.destination); assert.equal(ix.accounts[16], operation.record); assert.equal(ix.program, operation.consumer);
    const checked = pair(results, byLabel, operation.label + '-commit', entry, operation, ix);
    for (const [address, before] of checked.before) {
      const after = checked.after.get(address);
      assert.notDeepEqual(after.data, before.data, `Expected atomic effect missing at ${address}`);
      for (const field of ['owner', 'executable', 'lamports']) assert.equal(after[field], before[field], `Unexpected commit metadata change at ${address}`);
    }
    const qBefore = checked.before.get(P.quota).data, qAfter = checked.after.get(P.quota).data;
    const permitBefore = checked.before.get(operation.permit).data, permit = checked.after.get(operation.permit).data;
    assert.equal(permitBefore[0], 0); assert.equal(permitBefore[1], 1); assert.equal(permit[0], 2); assert.equal(permit[1], 1);
    assert(permit.subarray(1).equals(permitBefore.subarray(1)), 'Consumption changed immutable permit fields');
    assert.equal(qAfter.readBigUInt64LE(0), qBefore.readBigUInt64LE(0) + 1n);
    assert(qBefore.subarray(0, 8).equals(permit.subarray(8, 16))); assert(qBefore.subarray(8, 40).equals(permit.subarray(16, 48)));
    assert(qAfter.subarray(40, 88).equals(permit.subarray(464, 512))); assert(qAfter.subarray(8, 40).equals(permit.subarray(48, 80)));
    const record = checked.after.get(operation.record).data;
    assert(allZero(checked.before.get(operation.record).data)); assert.equal(record.at(-1), 1);
    assert.equal(record.subarray(0, 8).toString(), ix.program === P.merchant ? 'PURCH001' : 'LICENSE1');
    assert(record.subarray(8, 40).equals(publicKeyBytes(ix.accounts[11])));
    assert(record.subarray(40, ix.program === P.merchant ? 48 : 80).equals(ix.data.subarray(1, ix.program === P.merchant ? 9 : 41)), 'Paid effect differs from signed consumer action');
    commits.push({ label, signature: entry.signature, changedAccounts: checked.before.size, beforeSlot: checked.beforeSlot,
      transactionSlot: checked.transactionSlot, afterSlot: checked.afterSlot, exactEncryptedSuccessor: true });
    consumedLabels.add(operation.label + '-commit-before'); consumedLabels.add(operation.label + '-commit-after');
  }
  assert.equal(commits.length, results.scenario === 'conflict' ? 1 : 2, 'Archive is missing an expected paid commit snapshot pair');
  if (results.scenario === 'compatible') assert.deepEqual(results.operations.map(op => op.kind).sort(), ['license', 'merchant']);
  assert.equal(consumedLabels.size, byLabel.size, 'Unmatched or unverified account snapshots remain');
  return { available: true, snapshotCount: byLabel.size, rejectedTransactions: comparisons.length,
    rejectedAccountComparisons: comparisons.reduce((sum, entry) => sum + entry.accountsCompared, 0), rejections: comparisons, commits,
    limitation: 'Equality is independently recomputed from retained confirmed RPC account bytes and metadata, not historical state proofs; payer fees and untracked accounts are outside this comparison' };
}
