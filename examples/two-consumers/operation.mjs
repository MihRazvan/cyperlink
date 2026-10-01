import { createHash } from 'node:crypto';
import { ensure } from '../../packages/local-client/src/runtime.mjs';
import { buildMerchantDigest, buildLicenseDigest, buildActionTemplate } from '../../packages/sdk/src/index.mjs';

export const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts)).digest();
export function u64(value) { const out = Buffer.alloc(8); out.writeBigUInt64LE(BigInt(value)); return out; }
export function consumerDigest(kind, { record, product, expiry, owner, destination, mint }) {
  ensure(kind === 'merchant' || kind === 'license', 'Unsupported consumer');
  return kind === 'merchant'
    ? buildMerchantDigest({ effect: record, sku: product.readBigUInt64LE(0), owner, destination, mint })
    : buildLicenseDigest({ effect: record, product, expirySlot: BigInt(expiry), owner, destination, mint });
}

/** Exact current 464-byte immutable action input, excluding callback-only fields. */
export const actionTemplate = buildActionTemplate;

export function parseQuota(bytes) {
  ensure(bytes.length === 161 && bytes[128] === 1, 'Expected initialized v3 quota161');
  ensure(bytes.subarray(129).every(byte => byte === 0), 'Transient permit route was not cleared');
  return { version: bytes.readBigUInt64LE(0).toString(), stateHash: bytes.subarray(8, 40).toString('hex'),
    nonce: bytes.subarray(40, 56).toString('hex'), ciphertext: bytes.subarray(56, 88).toString('hex'),
    counter: bytes.readBigUInt64LE(88).toString() };
}

export function assertSettlementEffect(beforeQuota, afterQuota, permit, record, kind) {
  parseQuota(beforeQuota); parseQuota(afterQuota);
  ensure(afterQuota.readBigUInt64LE(0) === beforeQuota.readBigUInt64LE(0) + 1n, 'Commit must advance quota exactly once');
  ensure(permit.length === 520 && permit[0] === 2 && permit[1] === 1, 'Expected consumed authenticated permit');
  ensure(afterQuota.subarray(40, 88).equals(permit.subarray(464, 512)), 'Commit did not install exact authenticated encrypted successor');
  ensure(afterQuota.subarray(8, 40).equals(sha256(permit.subarray(464, 512))), 'Successor hash mismatch');
  ensure(record.length === (kind === 'merchant' ? 49 : 81) && record.at(-1) === 1,
    'Paid consumer entitlement was not installed');
  ensure(record.subarray(0, 8).equals(Buffer.from(kind === 'merchant' ? 'PURCH001' : 'LICENSE1')),
    'Consumer record discriminator mismatch');
}
