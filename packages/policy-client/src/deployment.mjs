import { createHash } from 'node:crypto';
import { publicKeyBytes, requireEvidence } from '../../sdk/src/codec.mjs';
const hex32 = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
export const policyDomainHash = d => createHash('sha256').update(Buffer.concat([Buffer.from('cyperlink-policy-domain-v1'), publicKeyBytes(d.programs.auth), publicKeyBytes(d.programs.policy), publicKeyBytes(d.quota), Buffer.from(d.releaseHashHex, 'hex'), Buffer.from(d.schemaHashHex, 'hex')])).digest('hex');
export const canonicalHash = value => createHash('sha256').update(canonical(value)).digest('hex');
/** Public deployment identity. Trust is rooted in matching loaded programs/state, not an editable JSON label. */
export function validateDeployment(d) {
  requireEvidence(d?.schema === 1 && d.profile === 'local-custom-policy-v1', 'Unsupported custom policy deployment');
  for (const key of ['releaseHashHex', 'schemaHashHex', 'domainHashHex', 'mxePublicKeyHex']) requireEvidence(hex32(d[key]), `Invalid deployment ${key}`);
  for (const key of ['auth', 'policy', 'guard', 'kernel', 'merchant', 'license', 'proofBuffer']) publicKeyBytes(d.programs?.[key]);
  requireEvidence(d.programs.kernel === d.programs.guard && new Set(['auth', 'policy', 'guard', 'merchant', 'license', 'proofBuffer'].map(key => d.programs[key])).size === 6, 'Unsupported deployment kernel/guard identity or program aliases');
  publicKeyBytes(d.quota); publicKeyBytes(d.genesisHash);
  requireEvidence(d.cipher === 'cspl-rescue-scalar253-v1', 'Unsupported policy cipher domain');
  requireEvidence(Array.isArray(d.stateFields) && d.stateFields.length >= 1 && d.stateFields.length <= 4, 'Require one to four private state fields');
  requireEvidence(d.stateFields.every(field => field && /^[a-z][a-z0-9_]{0,47}$/.test(field.name) && field.type === 'u64' && Object.keys(field).sort().join(',') === 'name,type') && new Set(d.stateFields.map(field => field.name)).size === d.stateFields.length, 'Malformed private state schema');
  requireEvidence(d.schemaHashHex === canonicalHash({profile:d.profile,cipher:d.cipher,stateFields:d.stateFields,slots:4}), 'Private state schema hash mismatch');
  requireEvidence(d.domainHashHex === policyDomainHash(d), 'Policy key domain hash mismatch');
  return d;
}
export function deploymentProfile(d) {
  validateDeployment(d);
  return { name: d.profile, ...d.programs, quota: d.quota };
}
