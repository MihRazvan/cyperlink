import { createHash } from 'node:crypto';
import { open, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { buildActionTemplate, validateOperation, decodeQuota, publicKeyBytes, INITIAL_PROFILE } from '../../sdk/src/index.mjs';
import { ensure, REPO } from './runtime.mjs';

export const hash = (...parts) => createHash('sha256').update(Buffer.concat(parts)).digest();
export const hexBytes = (value, length, name) => {
  ensure(typeof value === 'string' && /^(?:[0-9a-f]{2})+$/.test(value), `Invalid ${name} hex`);
  const bytes = Buffer.from(value, 'hex'); ensure(length === undefined || bytes.length === length, `Invalid ${name} length`); return bytes;
};
export function decimal(value, bits = 64) {
  ensure(typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value), 'Use a canonical decimal string');
  const n = BigInt(value); ensure(n < 1n << BigInt(bits), `Value exceeds u${bits}`); return n;
}
export function le(value, length = 8) {
  ensure(typeof value === 'bigint' || typeof value === 'string', 'Use a bigint or canonical decimal string');
  ensure(Number.isSafeInteger(length) && length > 0 && length <= 32, 'Invalid integer byte width');
  let n = decimal(String(value), length * 8); const out = Buffer.alloc(length);
  for (let i = 0; i < length; i++, n >>= 8n) out[i] = Number(n & 255n); return out;
}
export const queryStateDigest = data => {
  ensure(data instanceof Uint8Array && data.length === 161, 'Expected quota161');
  return hash(Buffer.from('cyperlink-query-state-v1'), Buffer.from(data).subarray(0, 96));
};
export function descriptorDigest(descriptor) {
  return hash(Buffer.from(JSON.stringify(Object.fromEntries(Object.keys(descriptor).sort().map(k => [k, descriptor[k]]))))).toString('hex');
}

/** Validate retained intent without accepting expectations copied from a chain response. */
export function validateOperationPlan(plan) {
  ensure(plan?.schema === 1 && typeof plan.label === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(plan.label), 'Invalid operation plan');
  ensure(Number.isSafeInteger(plan.contextSlot) && plan.contextSlot >= 0, 'Invalid retained operation context slot');
  publicKeyBytes(plan.genesisHash); publicKeyBytes(plan.action);
  const { descriptor: d, query: q, binding: b } = plan;
  ensure(d && q && b && ['merchant', 'license'].includes(d.consumerKind), 'Explicit supported consumer kind required');
  hexBytes(plan.mxePublicKeyHex, 32, 'runtime MXE public key');
  const { template: t } = validateOperation(d);
  const quota = hexBytes(plan.quotaSnapshotHex, 161, 'quota snapshot'), decoded = decodeQuota(quota);
  ensure(decoded.initialized && decoded.admin === d.admin && decoded.counter < 0xffffffffffffffffn, 'Invalid retained quota authority/counter');
  ensure(quota.subarray(129).every(v => v === 0), 'Retained quota route is armed');
  ensure(d.queryStateHashHex === queryStateDigest(quota).toString('hex'), 'Signed query snapshot digest mismatch');
  ensure(t.quotaVersion === decoded.version && Buffer.from(t.previousHash).equals(Buffer.from(decoded.hash)), 'Retained query predecessor mismatch');
  ensure(t.successorNonce === decoded.counter + 1n, 'Retained query nonce differs from reserved successor');
  ensure(Array.isArray(b.proofAddresses) && b.proofAddresses.length === 3 && new Set(b.proofAddresses).size === 3, 'Three distinct proof context addresses required');
  ensure(Array.isArray(b.proofDataHex) && b.proofDataHex.length === 3, 'Three retained proof contexts required');
  const rebuilt = buildActionTemplate({ source: publicKeyBytes(t.source), mint: publicKeyBytes(t.mint), destination: publicKeyBytes(t.destination),
    owner: publicKeyBytes(d.owner), sourceData: hexBytes(b.sourceDataHex, undefined, 'source'), nativeData: hexBytes(b.nativeDataHex, undefined, 'native instruction'),
    proofKeys: b.proofAddresses.map(publicKeyBytes), proofData: b.proofDataHex.map(v => hexBytes(v, undefined, 'proof context')),
    newSource: t.newSourceCiphertext, commitment: t.amountCommitment, quota: publicKeyBytes(d.quota), consumer: publicKeyBytes(t.consumer), consumerContract: t.actionDigest });
  ensure(rebuilt.subarray(80).equals(t.bytes.subarray(80, 464)), 'Native/action bytes differ from retained intent');
  const inputHash = hash(hexBytes(q.publicKeyHex, 32, 'ephemeral public key'), hexBytes(q.clientNonceHex, 16, 'client nonce'),
    hexBytes(q.amountCiphertextHex, 32, 'encrypted amount'), hexBytes(q.openingCiphertextHex, 32, 'encrypted opening'),
    quota.subarray(40, 88), le(t.successorNonce, 16), t.amountCommitment);
  ensure(inputHash.toString('hex') === d.inputsHashHex, 'Encrypted query differs from retained intent');
  decimal(q.offset); ensure(decimal(q.expiry) === t.expiry, 'Query expiry mismatch');
  ensure(d.quota === INITIAL_PROFILE.quota, 'Unsupported quota');
  return plan;
}

export async function readOperationPlan(filename) {
  const path = resolve(filename);
  ensure(path.startsWith(resolve(REPO, '.local') + '/') && await realpath(path) === path, 'Operation plan must be a local nonsymlink file');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    ensure(stat.isFile() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0 && stat.size < 100000, 'Operation plan must be a private bounded file');
    return validateOperationPlan(JSON.parse(await file.readFile('utf8')));
  } finally { await file.close(); }
}
