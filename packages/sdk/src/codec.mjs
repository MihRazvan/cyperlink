import { createHash } from 'node:crypto';

export class EvidenceError extends Error {
  constructor(message) { super(message); this.name = 'EvidenceError'; }
}
export const requireEvidence = (condition, message) => {
  if (!condition) throw new EvidenceError(message);
};
export const sha256 = (...parts) => createHash('sha256').update(Buffer.concat(parts)).digest();
export const equal = (a, b) => Buffer.from(a).equals(Buffer.from(b));
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export function publicKeyBytes(address) {
  requireEvidence(typeof address === 'string' && address.length <= 44 && address.length >= 32, 'Invalid public key');
  let value = 0n;
  for (const char of address) {
    const digit = alphabet.indexOf(char);
    requireEvidence(digit >= 0, 'Invalid base58 public key');
    value = value * 58n + BigInt(digit);
  }
  const bytes = [];
  while (value) { bytes.unshift(Number(value & 255n)); value >>= 8n; }
  for (const char of address) { if (char !== '1') break; bytes.unshift(0); }
  requireEvidence(bytes.length === 32, 'Public key must encode exactly 32 bytes');
  return Buffer.from(bytes);
}
export function publicKeyAddress(bytes) {
  const data = Buffer.from(bytes);
  requireEvidence(data.length === 32, 'Public key must be 32 bytes');
  let value = BigInt(`0x${data.toString('hex')}`), encoded = '';
  while (value) { encoded = alphabet[Number(value % 58n)] + encoded; value /= 58n; }
  for (const byte of data) { if (byte !== 0) break; encoded = '1' + encoded; }
  return encoded;
}
const key = (data, start) => publicKeyAddress(data.subarray(start, start + 32));
const u128 = (data, start) => data.readBigUInt64LE(start) | (data.readBigUInt64LE(start + 8) << 64n);
const allZero = data => data.every(byte => byte === 0);
export function accountBytes(account, address, owner, size) {
  requireEvidence(account && account.address === address, `Missing or misaddressed account ${address}`);
  requireEvidence(account.owner === owner && account.executable === false, `Wrong owner or executable account ${address}`);
  const data = Buffer.from(account.data);
  requireEvidence(data.length === size, `Unexpected account size at ${address}`);
  return data;
}
export function decodePermit(bytes) {
  const data = Buffer.from(bytes);
  requireEvidence(data.length === 520, 'Permit must be 520 bytes');
  requireEvidence(data[0] <= 3 && data[1] <= 1 && allZero(data.subarray(2, 8)), 'Unsupported permit state or profile');
  return {
    bytes: data, empty: allZero(data), state: data[0], decision: data[1],
    quotaVersion: data.readBigUInt64LE(8), previousHash: data.subarray(16, 48), successorHash: data.subarray(48, 80),
    source: key(data, 80), mint: key(data, 112), destination: key(data, 144), owner: key(data, 176),
    sourceHash: data.subarray(208, 240), nativeHash: data.subarray(240, 272),
    newSourceCiphertext: data.subarray(272, 336), amountCommitment: data.subarray(336, 368),
    quota: key(data, 368), consumer: key(data, 400), actionDigest: data.subarray(432, 464),
    successorNonce: u128(data, 464), successorCiphertext: data.subarray(480, 512), expiry: data.readBigUInt64LE(512),
  };
}
export function decodeJob(bytes) {
  const data = Buffer.from(bytes);
  requireEvidence(data.length === 1024, 'Current Job allocation must be 1024 bytes');
  requireEvidence(equal(data.subarray(0, 8), sha256(Buffer.from('account:Job')).subarray(0, 8)), 'Wrong Job discriminator');
  requireEvidence(data[8] === 1 && data[9] <= 4, 'Unsupported Job kind or status');
  requireEvidence(allZero(data.subarray(682)), 'Unsupported Job trailing fields');
  return { kind: data[8], status: data[9], owner: key(data, 10), computation: key(data, 42), permit: key(data, 74),
    nonce: u128(data, 106), expiry: data.readBigUInt64LE(122), template: decodePermit(data.subarray(130, 650)),
    inputsHash: data.subarray(650, 682) };
}
export function decodeQuota(bytes) {
  const data = Buffer.from(bytes);
  requireEvidence(data.length === 161 && data[128] <= 1, 'Unsupported quota layout');
  requireEvidence(allZero(data.subarray(129, 161)), 'Transient active permit persisted outside atomic settlement');
  const initialized = data[128] === 1;
  if (initialized) requireEvidence(equal(data.subarray(8, 40), sha256(data.subarray(40, 88))), 'Quota ciphertext hash mismatch');
  return { version: data.readBigUInt64LE(0), hash: data.subarray(8, 40), nonce: u128(data, 40),
    ciphertext: data.subarray(56, 88), counter: data.readBigUInt64LE(88), admin: key(data, 96), initialized };
}
export function decodeMerchantEntitlement(bytes) {
  const data = Buffer.from(bytes);
  requireEvidence(data.length === 49, 'Merchant entitlement must be 49 bytes');
  if (allZero(data)) return { issued: false };
  requireEvidence(data[48] === 1 && data.subarray(0, 8).toString('ascii') === 'PURCH001', 'Invalid merchant entitlement');
  return { issued: true, owner: key(data, 8), sku: data.readBigUInt64LE(40) };
}
