import { requireEvidence, sha256 } from './codec.mjs';

const bytes = (value, size, name) => {
  requireEvidence(value instanceof Uint8Array, `${name} must be Uint8Array bytes (Buffer is accepted)`);
  requireEvidence(size === undefined || value.byteLength === size, `${name} must be exactly ${size} bytes`);
  return Buffer.from(value);
};
const u64 = (value, name) => {
  requireEvidence(typeof value === 'bigint' || (typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value)), `${name} must be a bigint or canonical decimal string`);
  const number = BigInt(value);
  requireEvidence(number >= 0n && number <= 0xffffffffffffffffn, `${name} must fit unsigned 64 bits`);
  const encoded = Buffer.alloc(8); encoded.writeBigUInt64LE(number); return encoded;
};
const common = ({ owner, destination, mint }) => [bytes(owner, 32, 'owner'), bytes(destination, 32, 'destination'), bytes(mint, 32, 'mint')];

/** Public semantic digest only; does not issue, authorize or pay an entitlement. */
export function buildMerchantDigest({ effect, sku, ...addresses }) {
  return sha256(Buffer.from('merchant-purchase-v1'), bytes(effect, 32, 'effect'), u64(sku, 'sku'), ...common(addresses));
}
export function buildLicenseDigest({ effect, product, expirySlot, ...addresses }) {
  return sha256(Buffer.from('licensed-product-v1'), bytes(effect, 32, 'effect'), bytes(product, 32, 'product'),
    u64(expirySlot, 'expirySlot'), ...common(addresses));
}

/**
 * Assemble the exact 464-byte immutable native/action commitment input.
 * Proof data means complete current verified-context account bytes, ordered
 * equality/grouped/range. This encoder neither verifies proofs nor authorizes a
 * private query; submit its result through the owner-authorized preparation path.
 */
export function buildActionTemplate(input) {
  const source = bytes(input.source, 32, 'source'), mint = bytes(input.mint, 32, 'mint');
  const destination = bytes(input.destination, 32, 'destination'), owner = bytes(input.owner, 32, 'owner');
  requireEvidence(Array.isArray(input.proofKeys) && input.proofKeys.length === 3 && Array.isArray(input.proofData) && input.proofData.length === 3,
    'Three context keys and complete context account byte arrays are required, in equality/grouped/range order');
  const keys = input.proofKeys.map((value, index) => bytes(value, 32, `proofKeys[${index}]`));
  const contexts = input.proofData.map((value, index) => bytes(value, undefined, `proofData[${index}]`));
  const sourceData = bytes(input.sourceData, undefined, 'sourceData'), nativeData = bytes(input.nativeData, undefined, 'nativeData');
  requireEvidence(sourceData.length > 0 && nativeData.length > 0 && contexts.every(context => context.length > 0), 'Native account, instruction and context bytes may not be empty');
  const template = Buffer.alloc(464);
  const fields = [
    [80, source], [112, mint], [144, destination], [176, owner],
    [208, sha256(sourceData)], [240, sha256(nativeData, source, mint, destination, ...keys, owner, ...contexts)],
    [272, bytes(input.newSource, 64, 'newSource')], [336, bytes(input.commitment, 32, 'commitment')],
    [368, bytes(input.quota, 32, 'quota')], [400, bytes(input.consumer, 32, 'consumer')],
    [432, bytes(input.consumerContract, 32, 'consumerContract')],
  ];
  for (const [offset, value] of fields) value.copy(template, offset);
  return template;
}
