import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, writeFile, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readonlyFetch, verifyLandedReceipt, publicObservation, sessionIntentHash, main } from './verify-session.mjs';
import { REPO } from '../../packages/local-client/src/runtime.mjs';

test('review transport permits only explicit loopback account/receipt reads and rejects sends before fetch', async () => {
  const calls = [], read = readonlyFetch('http://127.0.0.1:8899', async (...args) => { calls.push(args); return 'read'; });
  assert.equal(await read('http://127.0.0.1:8899/', { body: JSON.stringify({ method: 'getTransaction' }) }), 'read');
  assert.equal(calls[0][1].redirect, 'error');
  for (const method of ['sendTransaction', 'requestAirdrop', 'simulateTransaction', 'getLatestBlockhash']) {
    await assert.rejects(read('http://127.0.0.1:8899', { body: JSON.stringify({ method }) }), /non-read/);
  }
  await assert.rejects(read('http://127.0.0.1:8899', { body: JSON.stringify([{ method: 'getAccountInfo' }, { method: 'sendTransaction' }]) }), /non-read/);
  await assert.rejects(read('https://api.mainnet-beta.solana.com', { body: '{}' }), /loopback/);
  assert.equal(calls.length, 1);
});

function fixture() {
  const message = Buffer.from([1, 2, 3]);
  const saved = { message, signatures: ['signature'], record: { minContextSlot: 7, loadedAddresses: { writable: ['loaded'], readonly: [] } } };
  const receipt = { slot: 8, transaction: { message: { serialize: () => Buffer.from(message) }, signatures: ['signature'] },
    meta: { err: null, fee: 5000, computeUnitsConsumed: 123, loadedAddresses: { writable: [{ toBase58: () => 'loaded' }], readonly: [] } } };
  return { saved, receipt };
}
test('receipt checks bind actual message, every signature, lookup resolution and retained slot', () => {
  const f = fixture(); assert.deepEqual(verifyLandedReceipt(f.saved, f.receipt), { slot: 8, succeeded: true, feeLamports: 5000, landedCU: 123 });
  for (const mutate of [f => { f.receipt.transaction.message.serialize = () => Buffer.from([9]); },
    f => { f.receipt.transaction.signatures = ['changed']; }, f => { f.receipt.meta.loadedAddresses.writable = []; },
    f => { f.receipt.slot = 6; }]) {
    const altered = fixture(); mutate(altered); assert.throws(() => verifyLandedReceipt(altered.saved, altered.receipt));
  }
});
test('missing or rejected receipt cannot become successful payment evidence', () => {
  const f = fixture(); assert.equal(verifyLandedReceipt(f.saved, null), null);
  f.receipt.meta.err = { InstructionError: [1, { Custom: 803 }] };
  assert.equal(verifyLandedReceipt(f.saved, f.receipt).succeeded, false);
});
test('public observation omits private amounts, unknown nested secrets and detailed local state', () => {
  const result = publicObservation({ status: 'committed', slot: 42, quotaVersion: '2', amount: 'SENSITIVE_SENTINEL',
    privateKey: 'SENSITIVE_SENTINEL', details: { secret: 'SENSITIVE_SENTINEL' } });
  assert.deepEqual(result, { status: 'committed', slot: 42, quotaVersion: '2' });
  assert(!JSON.stringify(result).includes('SENSITIVE_SENTINEL'));
  assert.throws(() => publicObservation({ status: { secret: 'SENSITIVE_SENTINEL' }, slot: 42 }));
});
test('existing output fails before bootstrap access or RPC and remains unchanged', async t => {
  const directory = await mkdtemp(resolve(REPO, '.local/session-review-host-')); await chmod(directory, 0o700);
  t.after(() => rm(directory, { force: true, recursive: true }));
  const output = resolve(directory, 'report.json'); await writeFile(output, 'preserve', { mode: 0o600 });
  await assert.rejects(main(['--bootstrap', '/missing-bootstrap', '--session', '/missing-session', '--out', output]), /already exists/);
  assert.equal(await readFile(output, 'utf8'), 'preserve');
});

test('concurrent cached observation refresh is allowed; amount, identity or signing changes alter retained intent', () => {
  const state = { schema: 1, id: 'session', genesis: 'ledger', bootstrap: 'path', operations: [
    { id: 'op', consumer: 'merchant', amount: 40, planHash: 'plan', tickets: { query: { signature: 'sig' } }, observation: { slot: 1 } }] };
  const refreshed = structuredClone(state); refreshed.operations[0].observation.slot = 2;
  assert.equal(sessionIntentHash(refreshed), sessionIntentHash(state));
  for (const mutate of [s => { s.operations[0].amount = 60; }, s => { s.operations[0].tickets.query.signature = 'other'; },
    s => { s.operations[0].inFlight = 'approve-commit'; }, s => { s.operations.push({ id: 'new' }); }]) {
    const changed = structuredClone(state); mutate(changed); assert.notEqual(sessionIntentHash(changed), sessionIntentHash(state));
  }
});
