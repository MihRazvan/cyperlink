import test from 'node:test';
import assert from 'node:assert/strict';
import { parse, view } from './app.mjs';
const common = ['--instance', '.local/instance.json', '--operation', '.local/operation'];
const signers = ['--admin-keyfile', '.local/admin.json', '--owner-keyfile', '.local/owner.json'];
const prepare = ['prepare', ...common, ...signers, '--amount', '30', '--product', 'ab'.repeat(32), '--expiry-slot', '1000', '--label', 'purchase-one'];
test('preparation requires explicit owner/admin, exact native amount and exact license action', () => {
  assert.equal(parse(prepare).options.amount, '30');
  for (const field of ['--owner-keyfile', '--admin-keyfile', '--product', '--expiry-slot']) {
    const bad = [...prepare], i = bad.indexOf(field); bad.splice(i, 2);
    assert.throws(() => parse(bad));
  }
  for (const invalid of ['0', '-1', '1.5', '01', '281474976710656', '9007199254740993']) {
    const bad = [...prepare]; bad[bad.indexOf('--amount') + 1] = invalid;
    assert.throws(() => parse(bad));
  }
});
test('keyless commands reject signing keys and recovery needs an explicit ticket role', () => {
  assert.equal(parse(['observe', ...common]).command, 'observe');
  assert.throws(() => parse(['observe', ...common, ...signers]));
  assert.throws(() => parse(['recover', ...common]));
  assert.equal(parse(['recover', ...common, '--role', 'commit', '--submit', 'yes']).options.role, 'commit');
  assert.throws(() => parse(['recover', ...common, '--role', 'commit', '--submit', 'true']));
});
test('authorization, landed delivery, and expired-unresolved delivery never establish payment', () => {
  assert.equal(view({ status: 'authorized' }, { status: 'landed' }).paymentCommitted, false);
  assert.equal(view({ status: 'authorized' }).outcome, 'authorized');
  assert.equal(view({ status: 'queued' }, { status: 'expired-unresolved' }).outcome, 'unresolved');
  assert.equal(view({ status: 'denied' }).status, 'denied');
  assert.equal(view({ status: 'denied' }).outcome, 'rejected');
  assert.equal(view({ status: 'stale' }).outcome, 'action-required');
  assert.equal(view({ status: 'expired' }, { status: 'expired-unresolved' }).paymentCommitted, false);
  assert.equal(view({ status: 'committed' }).paymentCommitted, true);
});
