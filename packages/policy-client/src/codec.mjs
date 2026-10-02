import { decodePermit as legacyPermit, publicKeyAddress, sha256, equal, requireEvidence } from '../../sdk/src/codec.mjs';
export { accountBytes, publicKeyBytes, publicKeyAddress, sha256, equal, requireEvidence, EvidenceError,
 decodeMerchantEntitlement, decodeLicenseEntitlement } from '../../sdk/src/codec.mjs';
const zero = data => data.every(byte => byte === 0);
const u128 = (data, offset) => data.readBigUInt64LE(offset) | (data.readBigUInt64LE(offset + 8) << 64n);
const nonceBytes = nonce => { const data = Buffer.alloc(16); data.writeBigUInt64LE(nonce & ((1n << 64n) - 1n)); data.writeBigUInt64LE(nonce >> 64n, 8); return data; };
export const stateHash = (nonce, ciphertexts, release, schema, domain) => sha256(Buffer.from('cyperlink-private-state-v1'), release, schema, domain, nonceBytes(nonce), ciphertexts);
export function decodePermit(bytes) {
 const data = Buffer.from(bytes); requireEvidence(data.length === 712, 'Custom permit must be 712 bytes');
 const base = legacyPermit(data.subarray(0, 520));
 return { ...base, bytes: data, empty: zero(data), successorCiphertexts: Buffer.concat([data.subarray(480, 512), data.subarray(520, 616)]),
 release: data.subarray(616, 648), schema: data.subarray(648, 680), domain: data.subarray(680, 712) };
}
export function decodeQuota(bytes) {
 const data = Buffer.from(bytes); requireEvidence(data.length === 353 && data[128] <= 1, 'Unsupported custom policy state layout');
 requireEvidence(zero(data.subarray(129, 161)), 'Transient active permit persisted outside atomic settlement');
 const value = { version: data.readBigUInt64LE(0), hash: data.subarray(8, 40), nonce: u128(data, 40),
 ciphertexts: Buffer.concat([data.subarray(56, 88), data.subarray(161, 257)]), counter: data.readBigUInt64LE(88),
 admin: publicKeyAddress(data.subarray(96, 128)), initialized: data[128] === 1,
 release: data.subarray(257, 289), schema: data.subarray(289, 321), domain: data.subarray(321, 353) };
 if (value.initialized) requireEvidence(equal(value.hash, stateHash(value.nonce, value.ciphertexts, value.release, value.schema, value.domain)), 'Full custom policy state ciphertext hash mismatch');
 return value;
}
export function decodeJob(bytes) {
 const data = Buffer.from(bytes); requireEvidence(data.length === 1200, 'Custom Job allocation must be 1200 bytes');
 requireEvidence(equal(data.subarray(0, 8), sha256(Buffer.from('account:Job')).subarray(0, 8)), 'Wrong Job discriminator');
 requireEvidence(data[8] === 1 && data[9] <= 4 && zero(data.subarray(874)), 'Unsupported custom Job kind/status/trailing fields');
 const key = offset => publicKeyAddress(data.subarray(offset, offset + 32));
 return { kind: data[8], status: data[9], owner: key(10), computation: key(42), permit: key(74), nonce: u128(data, 106),
 expiry: data.readBigUInt64LE(122), template: decodePermit(data.subarray(130, 842)), inputsHash: data.subarray(842, 874) };
}
