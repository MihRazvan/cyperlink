export { EvidenceError, decodeJob, decodePermit, decodeQuota, decodeMerchantEntitlement, publicKeyAddress, publicKeyBytes } from './codec.mjs';
export { LocalRpcTransport } from './transport.mjs';
import { accountBytes, decodeJob, decodePermit, decodeQuota, decodeMerchantEntitlement,
  equal, publicKeyAddress, publicKeyBytes, requireEvidence, sha256 } from './codec.mjs';

export const INITIAL_PROFILE = Object.freeze({
  name: 'local-native-ct-v0',
  auth: '5bgSoi3WbUndQNhWrkxJoURjkRd28BxxucZozwGR9AQQ',
  policy: publicKeyAddress(Buffer.alloc(32, 82)),
  merchant: publicKeyAddress(Buffer.alloc(32, 83)),
  quota: publicKeyAddress(Buffer.alloc(32, 61)),
});
const hex = (value, size, label) => {
  requireEvidence(typeof value === 'string' && new RegExp(`^[a-fA-F0-9]{${size * 2}}$`).test(value), `Invalid ${label}`);
  return Buffer.from(value, 'hex');
};
const zero = bytes => bytes.every(byte => byte === 0);
export function validateOperation(operation) {
  requireEvidence(operation?.profile === INITIAL_PROFILE.name, 'Unsupported operation profile');
  for (const field of ['job', 'computation', 'permit', 'owner', 'admin', 'quota', 'effect']) publicKeyBytes(operation[field]);
  requireEvidence(operation.quota === INITIAL_PROFILE.quota, 'Only the configured initial quota is supported');
  requireEvidence(new Set([operation.job, operation.permit, operation.quota, operation.effect]).size === 4, 'Operation account aliases');
  requireEvidence(typeof operation.sku === 'string' && /^(0|[1-9][0-9]*)$/.test(operation.sku), 'SKU must be a decimal u64 string');
  const sku = BigInt(operation.sku);
  requireEvidence(sku <= 0xffffffffffffffffn, 'SKU exceeds u64');
  const template = decodePermit(hex(operation.templateHex, 520, 'queued template'));
  requireEvidence(template.state === 0 && template.decision === 0 && zero(template.successorHash) && zero(template.successorCiphertext), 'Expected immutable queued Job template');
  requireEvidence(template.owner === operation.owner && template.quota === operation.quota && template.consumer === INITIAL_PROFILE.merchant, 'Operation owner/quota/consumer binding mismatch');
  const skuBytes = Buffer.alloc(8); skuBytes.writeBigUInt64LE(sku);
  const digest = sha256(Buffer.from('merchant-purchase-v1'), publicKeyBytes(operation.effect), skuBytes,
    publicKeyBytes(operation.owner), publicKeyBytes(template.destination), publicKeyBytes(template.mint));
  requireEvidence(equal(digest, template.actionDigest), 'Merchant effect/action binding mismatch');
  return { template, sku, inputsHash: hex(operation.inputsHashHex, 32, 'encrypted inputs hash') };
}

/** Reconcile a single-bank snapshot, never a signature or callback notification. */
export function reconcileOperation(operation, snapshot) {
  const expected = validateOperation(operation);
  requireEvidence(Number.isSafeInteger(snapshot?.slot) && snapshot.slot >= 0, 'Invalid observation slot');
  requireEvidence(['confirmed', 'finalized'].includes(snapshot.commitment), 'Unsupported observation commitment');
  requireEvidence(Array.isArray(snapshot.accounts) && snapshot.accounts.length === 4, 'Expected Job, permit, quota and merchant effect in one snapshot');
  const [jobAccount, permitAccount, quotaAccount, effectAccount] = snapshot.accounts;
  const permit = decodePermit(accountBytes(permitAccount, operation.permit, INITIAL_PROFILE.policy, 520));
  const quota = decodeQuota(accountBytes(quotaAccount, operation.quota, INITIAL_PROFILE.policy, 161));
  const effect = decodeMerchantEntitlement(accountBytes(effectAccount, operation.effect, INITIAL_PROFILE.merchant, 49));
  requireEvidence(quota.initialized && quota.admin === operation.admin, 'Quota is uninitialized or administrator changed');
  if (effect.issued) requireEvidence(effect.owner === operation.owner && effect.sku === expected.sku, 'Merchant entitlement binding mismatch');
  const result = (status, actions, reason) => ({ status, slot: snapshot.slot, commitment: snapshot.commitment,
    job: operation.job, permit: operation.permit, effect: operation.effect,
    quotaVersion: quota.version.toString(), expectedQuotaVersion: expected.template.quotaVersion.toString(),
    actions, ...(reason ? { reason } : {}) });
  if (jobAccount === null) {
    requireEvidence(permit.empty && !effect.issued, 'Operation absent but settlement evidence exists');
    return result('unobserved', ['observe'], 'No Job at this commitment; this does not prove a submitted transaction failed');
  }
  const job = decodeJob(accountBytes(jobAccount, operation.job, INITIAL_PROFILE.auth, 1024));
  requireEvidence(job.owner === operation.owner && job.computation === operation.computation && job.permit === operation.permit, 'Immutable Job identity mismatch');
  requireEvidence(equal(job.template.bytes, expected.template.bytes) && equal(job.inputsHash, expected.inputsHash), 'Immutable Job action or encrypted-input binding mismatch');
  requireEvidence(job.nonce === job.template.successorNonce && job.expiry === job.template.expiry, 'Job nonce or expiry disagrees with template');
  if (permit.decision === 1) {
    for (const [from, to] of [[2, 48], [80, 480], [512, 520]]) {
      requireEvidence(equal(permit.bytes.subarray(from, to), job.template.bytes.subarray(from, to)), 'Permit disagrees with immutable Job');
    }
    requireEvidence(equal(permit.successorHash, sha256(permit.bytes.subarray(464, 512))), 'Permit successor ciphertext hash mismatch');
  }
  requireEvidence(permit.state !== 1, 'Armed permit persisted without atomic completion');
  const previous = quota.version === job.template.quotaVersion && equal(quota.hash, job.template.previousHash);
  const expired = BigInt(snapshot.slot) > job.expiry;
  requireEvidence(quota.version >= job.template.quotaVersion, 'Quota regressed behind operation');
  if (quota.version === job.template.quotaVersion) requireEvidence(previous, 'Quota hash changed without version advancement');
  if (permit.state === 2 || effect.issued) {
    requireEvidence(job.status === 1 && permit.state === 2 && permit.decision === 1 && effect.issued, 'Partial or conflicting committed effects');
    requireEvidence(quota.version > job.template.quotaVersion, 'Consumed permit without quota advancement');
    if (quota.version === job.template.quotaVersion + 1n) {
      requireEvidence(equal(quota.hash, permit.successorHash) && quota.nonce === permit.successorNonce && equal(quota.ciphertext, permit.successorCiphertext), 'Committed quota is not the exact authorized successor');
    }
    return result('committed', [], 'Consumed bound permit, paid merchant entitlement and advanced quota observed together');
  }
  if (job.status === 3) {
    requireEvidence(permit.state === 3 && (permit.decision === 1 || zero(permit.bytes.subarray(1))), 'Cancelled Job without matching cancelled permit');
    return result('cancelled', ['prepare-fresh-with-owner-and-admin']);
  }
  if (job.status === 2 || job.status === 4) {
    requireEvidence(permit.empty, 'Terminal nonadmitted Job has permit effects');
    return result(job.status === 2 ? 'denied' : 'invalidated', ['prepare-fresh-with-owner-and-admin']);
  }
  if (job.status === 0) requireEvidence(permit.empty, 'Pending Job already has permit effects');
  if (job.status === 1) requireEvidence(permit.state === 0 && permit.decision === 1, 'Admitted Job lacks authenticated permit');
  if (expired) return result('expired', ['cancel-with-owner', 'prepare-fresh-with-owner-and-admin']);
  if (!previous) return result('stale', ['cancel-with-owner', 'prepare-fresh-with-owner-and-admin']);
  return job.status === 0 ? result('queued', ['observe', 'cancel-with-owner'])
    : result('authorized', ['submit-owner-signed-commit', 'cancel-with-owner'], 'Authorization is not a reservation; settlement revalidates current native state');
}

/** Observations are monotonic by context slot within one reader. */
export class OperationReader {
  constructor(transport) { this.transport = transport; this.minimumSlot = undefined; }
  async observe(operation) {
    validateOperation(operation);
    const snapshot = await this.transport.readAccounts([operation.job, operation.permit, operation.quota, operation.effect],
      { minContextSlot: this.minimumSlot });
    requireEvidence(this.minimumSlot === undefined || snapshot.slot >= this.minimumSlot, 'Transport returned a regressed snapshot');
    const observation = reconcileOperation(operation, snapshot);
    this.minimumSlot = snapshot.slot;
    return observation;
  }
}
