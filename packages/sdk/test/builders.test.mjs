import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { buildMerchantDigest, buildLicenseDigest, buildActionTemplate } from '../src/index.mjs';
const b = (value, size = 32) => new Uint8Array(size).fill(value);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const common = () => ({ effect: b(1), owner: b(2), destination: b(3), mint: b(4) });
const action = () => ({ source: b(6), mint: b(4), destination: b(3), owner: b(2), sourceData: b(7, 470), nativeData: b(8, 33),
  proofKeys: [b(9), b(10), b(11)], proofData: [b(12, 129), b(13, 193), b(14, 297)], newSource: b(15, 64), commitment: b(16),
  quota: b(17), consumer: b(83), consumerContract: buildMerchantDigest({ ...common(), sku: 7n }) });

test('consumer builders preserve independently captured example digest vectors', () => {
  assert.equal(Buffer.from(buildMerchantDigest({ ...common(), sku: 7n })).toString('hex'), 'ab2e53fc0daef411ef1d7575ebc5da3dbac9b2fd01141da72cc3e90db6b6579a');
  assert.equal(Buffer.from(buildLicenseDigest({ ...common(), product: b(5), expirySlot: '1234' })).toString('hex'), '5008f8ec56cd4043727f3b2409db1fd3a8b29a77c265ef4db387e17c2204b92b');
  assert.deepEqual(buildMerchantDigest({ ...common(), sku: 7n }), buildMerchantDigest({ ...common(), sku: '7' }));
});
test('action builder preserves exact 464-byte layout and captured example hash with plain Uint8Array input', () => {
  const input = action(), result = buildActionTemplate(input);
  assert.equal(result.length, 464); assert(result.subarray(0, 80).every(byte => byte === 0));
  assert.equal(hash(result), '7ff8e2e2a212120a40c1655ace87af566d00edb083a893b067612b38342f7dbf');
  const captured = Buffer.from(result); input.source.fill(99); assert.deepEqual(result, captured, 'returned template must not alias client inputs');
  for (const change of [x => x.nativeData[0] ^= 1, x => x.sourceData[0] ^= 1, x => x.proofData[0][0] ^= 1,
    x => x.proofKeys.reverse(), x => x.proofData.reverse(), x => x.destination[0] ^= 1, x => x.consumerContract[0] ^= 1]) {
    const changed = action(); change(changed); assert.notEqual(hash(buildActionTemplate(changed)), hash(captured));
  }
});
test('builders reject ambiguous integer encodings, wrong byte sizes and incomplete proof contexts', () => {
  for (const sku of [7, -1n, 1n << 64n, '-1', '01', '7.0', '1e3']) assert.throws(() => buildMerchantDigest({ ...common(), sku }));
  for (const product of [b(1, 31), b(1, 33), '00'.repeat(32), Array(32).fill(0)]) assert.throws(() => buildLicenseDigest({ ...common(), product, expirySlot: 5n }));
  for (const mutate of [x => x.source = b(1, 31), x => x.newSource = b(1, 32), x => x.commitment = b(1, 64),
    x => x.proofKeys.pop(), x => x.proofData.pop(), x => x.proofKeys[0] = b(1, 33), x => x.proofData[0] = new Uint8Array(),
    x => x.nativeData = 'abcd', x => x.sourceData = new Uint8Array()]) {
    const input = action(); mutate(input); assert.throws(() => buildActionTemplate(input));
  }
});
