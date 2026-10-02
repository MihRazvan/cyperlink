import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { REPO, loadWeb3 } from '../src/runtime.mjs';
import { SignedInstructionSender, waitForFinalizedLookupTable } from '../src/transaction-sender.mjs';

const web3 = await loadWeb3(process.env.CYPERLINK_JS_MODULE_ROOT ?? resolve(REPO, '.local/toolchain/js'));
const key = n => new web3.PublicKey(Buffer.alloc(32, n));
const tableKey = key(90), prior = key(91), appended = key(92);
function table(addresses, lastExtendedSlot) {
  return new web3.AddressLookupTableAccount({ key: tableKey, state: {
    deactivationSlot: 18446744073709551615n, lastExtendedSlot, lastExtendedSlotStartIndex: 0, authority: key(93), addresses,
  } });
}

test('confirmed extension cannot bypass missing/older root table or same-slot activation', async () => {
  const responses = [
    { context: { slot: 90 }, value: null },
    { context: { slot: 99 }, value: table([prior], 80) },
    { context: { slot: 100 }, value: table([prior, appended], 100) },
    { context: { slot: 101 }, value: table([prior, appended], 100) },
  ];
  let polls = 0, waits = 0;
  const connection = { getAddressLookupTable: async (requested, config) => {
    assert(requested.equals(tableKey)); assert.deepEqual(config, { commitment: 'finalized' }); return responses[polls++];
  } };
  const resolved = await waitForFinalizedLookupTable(connection, tableKey, [prior, appended], { attempts: 4, intervalMs: 0, wait: async () => { waits++; } });
  assert.equal(polls, 4); assert.equal(waits, 3); assert.deepEqual(resolved.state.addresses, [prior, appended]);
});

test('lookupFor passes both retained and appended keys to finalized activation', async () => {
  let extended = false, confirmedReads = 0, finalizedReads = 0;
  const connection = { getAddressLookupTable: async (requested, config) => {
    assert(requested.equals(tableKey));
    if (!config) { confirmedReads++; return { context: { slot: 101 }, value: table([prior], 80) }; }
    assert.deepEqual(config, { commitment: 'finalized' }); assert(extended); finalizedReads++;
    return { context: { slot: 102 }, value: table([prior, key(94), appended], 100) };
  } };
  const sender = new SignedInstructionSender({ web3, connection, payer: { publicKey: key(93) } });
  sender.lookup = tableKey;
  sender.send = async (label, instructions) => { assert.equal(label, 'extend-demo-alt'); assert.equal(instructions.length, 1); extended = true; };
  const resolved = await sender.lookupFor([new web3.TransactionInstruction({ programId: key(94), data: Buffer.alloc(0), keys: [{ pubkey: appended, isSigner: false, isWritable: true }] })]);
  assert.equal(confirmedReads, 1); assert.equal(finalizedReads, 1); assert.deepEqual(resolved.state.addresses, [prior, key(94), appended]);
});

test('finalized wait is bounded and rejects missing keys, wrong table, or malformed context', async () => {
  let polls = 0;
  await assert.rejects(waitForFinalizedLookupTable({ getAddressLookupTable: async () => {
    polls++; return { context: { slot: 101 }, value: table([prior], 80) };
  } }, tableKey, [prior, appended], { attempts: 3, intervalMs: 0, wait: async () => {} }), /activation timeout/);
  assert.equal(polls, 3);
  const wrong = table([prior, appended], 100); wrong.key = key(95);
  await assert.rejects(waitForFinalizedLookupTable({ getAddressLookupTable: async () => ({ context: { slot: 101 }, value: wrong }) }, tableKey, [prior]), /key differs/);
  await assert.rejects(waitForFinalizedLookupTable({ getAddressLookupTable: async () => ({ context: {}, value: null }) }, tableKey, [prior]), /context/);
});
