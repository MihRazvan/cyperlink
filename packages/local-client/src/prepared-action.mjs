import { createHash } from 'node:crypto';
import { INITIAL_PROFILE, publicKeyBytes } from '../../sdk/src/index.mjs';
import { ensure } from './runtime.mjs';
import { validateOperationPlan } from './operation-plan.mjs';

const sha256 = data => createHash('sha256').update(data).digest();
const discriminator = sha256(Buffer.from('account:PreparedAction')).subarray(0, 8);

/** Public account evidence only. This checks exact immutable action bytes, not native proofs. */
export function validatePreparedActionEvidence(plan, evidence) {
  validateOperationPlan(plan);
  ensure(evidence?.address === plan.action && evidence.owner === INITIAL_PROFILE.auth && evidence.executable === false,
    'PreparedAction account address, owner or executable flag differs from retained intent');
  ensure(Number.isSafeInteger(evidence.slot) && evidence.slot >= plan.contextSlot, 'PreparedAction evidence predates retained operation context');
  ensure(typeof evidence.dataBase64 === 'string' && evidence.dataBase64.length === 1600, 'PreparedAction account must contain exactly 1200 bytes');
  const data = Buffer.from(evidence.dataBase64, 'base64');
  ensure(data.length === 1200 && data.toString('base64') === evidence.dataBase64, 'Malformed PreparedAction account encoding');
  ensure(sha256(data).toString('hex') === evidence.sha256, 'PreparedAction evidence hash mismatch');
  ensure(data.subarray(0, 8).equals(discriminator), 'Wrong PreparedAction discriminator');
  ensure(data.subarray(8, 40).equals(publicKeyBytes(plan.descriptor.owner)), 'Immutable action owner differs from retained intent');
  const template = data.subarray(40, 504), retained = Buffer.from(plan.descriptor.templateHex, 'hex');
  ensure(template.subarray(0, 80).every(byte => byte === 0) && template.subarray(80).equals(retained.subarray(80, 464)),
    'Immutable action template differs from retained intent');
  const length = data.readUInt32LE(504);
  ensure(length <= 256 && data.subarray(508, 508 + length).equals(Buffer.from(plan.binding.nativeDataHex, 'hex')),
    'Immutable action native instruction differs from retained intent');
  ensure(data.subarray(508 + length).every(byte => byte === 0), 'Unsupported PreparedAction trailing data');
  return evidence;
}

/** Fetch the immutable account referenced by signed query bytes before a query send/recovery. */
export async function readPreparedActionEvidence(plan, web3, connection, { minContextSlot = plan.contextSlot } = {}) {
  validateOperationPlan(plan);
  ensure(Number.isSafeInteger(minContextSlot) && minContextSlot >= 0, 'Invalid PreparedAction minimum slot');
  const floor = Math.max(plan.contextSlot, minContextSlot);
  const response = await connection.getAccountInfoAndContext(new web3.PublicKey(plan.action), { commitment: 'confirmed', minContextSlot: floor });
  ensure(response?.value && Number.isSafeInteger(response.context?.slot) && response.context.slot >= floor,
    'PreparedAction unavailable at retained context');
  const account = response.value;
  ensure(account.data instanceof Uint8Array, 'Malformed PreparedAction account data');
  const data = Buffer.from(account.data);
  const evidence = { address: plan.action, owner: account.owner.toBase58(), executable: account.executable,
    slot: response.context.slot, dataBase64: data.toString('base64'), sha256: sha256(data).toString('hex') };
  return validatePreparedActionEvidence(plan, evidence);
}
