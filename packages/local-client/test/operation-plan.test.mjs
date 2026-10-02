import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOperationPlan, queryStateDigest, hash, le } from '../src/operation-plan.mjs';
import { buildActionTemplate, buildMerchantDigest, buildLicenseDigest, INITIAL_PROFILE as P, publicKeyBytes as bytes, publicKeyAddress as address } from '../../sdk/src/index.mjs';
const key = n => address(Buffer.alloc(32, n));
// Host-only serialization intent: these account bytes are not verified proofs.
function plan(kind = 'merchant') {
  const owner = key(1), admin = key(2), source = key(3), mint = key(4), destination = key(5), effect = key(6);
  const quota = Buffer.alloc(161); quota[128] = 1; bytes(admin).copy(quota, 96);
  quota[56] = 17; hash(quota.subarray(40, 88)).copy(quota, 8); quota.writeBigUInt64LE(3n, 88);
  const common = { effect: bytes(effect), owner: bytes(owner), destination: bytes(destination), mint: bytes(mint) };
  const consumer = kind === 'merchant' ? { sku: '7' } : { productHex32: Buffer.alloc(32, 8).toString('hex'), licenseExpirySlot: '90' };
  const digest = kind === 'merchant' ? buildMerchantDigest({ ...common, sku: consumer.sku })
    : buildLicenseDigest({ ...common, product: Buffer.from(consumer.productHex32, 'hex'), expirySlot: consumer.licenseExpirySlot });
  const binding = { sourceDataHex: '01', nativeDataHex: '0203', proofAddresses: [key(11), key(12), key(13)], proofDataHex: ['04', '05', '06'] };
  const native = buildActionTemplate({ source: bytes(source), mint: bytes(mint), destination: bytes(destination), owner: bytes(owner),
    sourceData: Buffer.from(binding.sourceDataHex, 'hex'), nativeData: Buffer.from(binding.nativeDataHex, 'hex'),
    proofKeys: binding.proofAddresses.map(bytes), proofData: binding.proofDataHex.map(v => Buffer.from(v, 'hex')),
    newSource: Buffer.alloc(64, 7), commitment: Buffer.alloc(32, 8), quota: bytes(P.quota), consumer: bytes(P[kind]), consumerContract: digest });
  const template = Buffer.alloc(520); native.copy(template); quota.subarray(8, 40).copy(template, 16);
  le(4n, 16).copy(template, 464); le(100n).copy(template, 512);
  const query = { offset: '29', expiry: '100', publicKeyHex: Buffer.alloc(32, 21).toString('hex'), clientNonceHex: Buffer.alloc(16, 22).toString('hex'),
    amountCiphertextHex: Buffer.alloc(32, 23).toString('hex'), openingCiphertextHex: Buffer.alloc(32, 24).toString('hex') };
  const inputs = hash(Buffer.from(query.publicKeyHex, 'hex'), Buffer.from(query.clientNonceHex, 'hex'), Buffer.from(query.amountCiphertextHex, 'hex'),
    Buffer.from(query.openingCiphertextHex, 'hex'), quota.subarray(40, 88), le(4n, 16), template.subarray(336, 368));
  return { schema: 1, contextSlot: 1, label: 'test-plan', action: key(19), genesisHash: key(20), quotaSnapshotHex: quota.toString('hex'),
    mxePublicKeyHex: Buffer.alloc(32, 25).toString('hex'), query, binding,
    descriptor: { profile: P.name, consumerKind: kind, job: key(14), computation: key(15), permit: key(16), owner, admin, quota: P.quota, effect,
      ...consumer, templateHex: template.toString('hex'), inputsHashHex: inputs.toString('hex'), queryStateHashHex: queryStateDigest(quota).toString('hex') } };
}

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
