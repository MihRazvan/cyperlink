import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOperationPlan, queryStateDigest, hash, le } from '../src/operation-plan.mjs';
import { buildActionTemplate, buildMerchantDigest, buildLicenseDigest, publicKeyBytes as bytes, publicKeyAddress as address } from '../../sdk/src/index.mjs';
import {plan} from './fixture.mjs';

test('merchant and license retained intent reconstruct their exact native and encrypted input hashes', () => {
  for (const kind of ['merchant', 'license']) assert.equal(validateOperationPlan(plan(kind)).descriptor.consumerKind, kind);
});

test('consumer kind is mandatory and integer encodings cannot silently round JavaScript numbers', () => {
  const missing = plan(); delete missing.descriptor.consumerKind;
  assert.throws(() => validateOperationPlan(missing), /Explicit supported consumer/);
  for (const value of [7, Number.MAX_SAFE_INTEGER + 1, -1n, '07', '18446744073709551616']) assert.throws(() => le(value));
  assert.equal(le('18446744073709551615').toString('hex'), 'ffffffffffffffff');
});

test('mutated source, proof order, native bytes, encrypted input or expected snapshot is rejected', () => {
  const mutate = [p => { p.binding.sourceDataHex = 'ff'; }, p => { p.binding.nativeDataHex = 'ff'; },
    p => p.binding.proofAddresses.reverse(), p => p.binding.proofDataHex.reverse(),
    p => { p.query.amountCiphertextHex = 'aa'.repeat(32); }, p => { p.query.clientNonceHex = 'bb'.repeat(16); },
    p => { p.query.expiry = '101'; }, p => { p.descriptor.queryStateHashHex = '00'.repeat(32); },
    p => { p.mxePublicKeyHex = '00'; }];
  for (const change of mutate) { const p = plan(); change(p); assert.throws(() => validateOperationPlan(p)); }
});

test('counter-only competition cannot be hidden by replacing just the snapshot digest', () => {
  const p = plan(), changed = Buffer.from(p.quotaSnapshotHex, 'hex'); changed.writeBigUInt64LE(4n, 88);
  p.quotaSnapshotHex = changed.toString('hex'); p.descriptor.queryStateHashHex = queryStateDigest(changed).toString('hex');
  assert.throws(() => validateOperationPlan(p), /nonce differs/);
});

test('complete extra state and immutable policy identity cannot be transplanted into retained operation', () => {
  for (const mutate of [p => {p.descriptor.deployment.releaseHashHex='dd'.repeat(32);},
    p => {p.descriptor.deployment.domainHashHex='ee'.repeat(32);},
    p => {p.descriptor.deployment.stateFields.reverse();},
    p => {p.descriptor.deployment.cipher='rescue-base255';},
    p => {const q=Buffer.from(p.quotaSnapshotHex,'hex');q[180]^=1;p.quotaSnapshotHex=q.toString('hex');},
    p => {const t=Buffer.from(p.descriptor.templateHex,'hex');t[640]^=1;p.descriptor.templateHex=t.toString('hex');}]) {
    const p=plan();mutate(p);assert.throws(()=>validateOperationPlan(p));
  }
});

test('query snapshot authenticates counter, administrator, routing header and all four cipher slots', () => {
 const p=plan(), original=Buffer.from(p.quotaSnapshotHex,'hex'), digest=queryStateDigest(original);
 for(const offset of [0,8,40,56,88,96,128,129,161,192,224,257,289,321,352]) {
  const changed=Buffer.from(original);changed[offset]^=1;assert.notDeepEqual(queryStateDigest(changed),digest);
 }
});
