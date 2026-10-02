import { validateOperationPlan, queryStateDigest, hash, le } from '../src/operation-plan.mjs';
import { buildActionTemplate, buildMerchantDigest, buildLicenseDigest, publicKeyBytes as bytes, publicKeyAddress as address } from '../../sdk/src/index.mjs';
const key = n => address(Buffer.alloc(32, n));
const deployment = { schema: 1, profile: 'local-custom-policy-v1', releaseHashHex: 'aa'.repeat(32), schemaHashHex: 'bb'.repeat(32), domainHashHex: 'cc'.repeat(32), mxePublicKeyHex: '19'.repeat(32), genesisHash: key(20), quota: key(81), cipher: 'cspl-rescue-scalar253-v1', stateFields: [{name:'remaining',type:'u64'},{name:'count',type:'u64'}], programs: { auth:key(80), policy:key(82), guard:key(83), kernel:key(84), merchant:key(85), license:key(86), proofBuffer:key(89) } };
import { canonicalHash, policyDomainHash } from '../src/deployment.mjs';
deployment.programs.kernel=deployment.programs.guard;
deployment.schemaHashHex=canonicalHash({profile:deployment.profile,cipher:deployment.cipher,stateFields:deployment.stateFields,slots:4});
deployment.domainHashHex=policyDomainHash(deployment);
const P = {...deployment.programs, quota:deployment.quota,name:deployment.profile};
import { stateHash, decodeQuota } from '../src/codec.mjs';

// Host-only serialization intent: these account bytes are not verified proofs.
export function plan(kind = 'merchant') {
  const owner = key(1), admin = key(2), source = key(3), mint = key(4), destination = key(5), effect = key(6);
  const quota = Buffer.alloc(353); quota[128] = 1; bytes(admin).copy(quota, 96);
  quota[56] = 17; Buffer.from(deployment.releaseHashHex+deployment.schemaHashHex+deployment.domainHashHex,'hex').copy(quota,257); stateHash(0n,Buffer.concat([quota.subarray(56,88),quota.subarray(161,257)]),quota.subarray(257,289),quota.subarray(289,321),quota.subarray(321,353)).copy(quota,8); quota.writeBigUInt64LE(3n, 88);
  const common = { effect: bytes(effect), owner: bytes(owner), destination: bytes(destination), mint: bytes(mint) };
  const consumer = kind === 'merchant' ? { sku: '7' } : { productHex32: Buffer.alloc(32, 8).toString('hex'), licenseExpirySlot: '90' };
  const digest = kind === 'merchant' ? buildMerchantDigest({ ...common, sku: consumer.sku })
    : buildLicenseDigest({ ...common, product: Buffer.from(consumer.productHex32, 'hex'), expirySlot: consumer.licenseExpirySlot });
  const binding = { sourceDataHex: '01', nativeDataHex: '0203', proofAddresses: [key(11), key(12), key(13)], proofDataHex: ['04', '05', '06'] };
  const native = buildActionTemplate({ source: bytes(source), mint: bytes(mint), destination: bytes(destination), owner: bytes(owner),
    sourceData: Buffer.from(binding.sourceDataHex, 'hex'), nativeData: Buffer.from(binding.nativeDataHex, 'hex'),
    proofKeys: binding.proofAddresses.map(bytes), proofData: binding.proofDataHex.map(v => Buffer.from(v, 'hex')),
    newSource: Buffer.alloc(64, 7), commitment: Buffer.alloc(32, 8), quota: bytes(P.quota), consumer: bytes(P[kind]), consumerContract: digest });
  const template = Buffer.alloc(712); native.copy(template); quota.subarray(8, 40).copy(template, 16);
  le(4n, 16).copy(template, 464); le(100n).copy(template, 512); quota.subarray(257,353).copy(template,616);
  const query = { offset: '29', expiry: '100', publicKeyHex: Buffer.alloc(32, 21).toString('hex'), clientNonceHex: Buffer.alloc(16, 22).toString('hex'),
    amountCiphertextHex: Buffer.alloc(32, 23).toString('hex'), openingCiphertextHex: Buffer.alloc(32, 24).toString('hex') };
  const inputs = hash(Buffer.from(query.publicKeyHex, 'hex'), Buffer.from(query.clientNonceHex, 'hex'), Buffer.from(query.amountCiphertextHex, 'hex'),
    Buffer.from(query.openingCiphertextHex, 'hex'), quota.subarray(40, 56), decodeQuota(quota).ciphertexts, le(4n, 16), template.subarray(336, 368),quota.subarray(257,353));
  return { schema: 1, contextSlot: 1, label: 'test-plan', action: key(19), genesisHash: key(20), quotaSnapshotHex: quota.toString('hex'),
    mxePublicKeyHex: Buffer.alloc(32, 25).toString('hex'), query, binding,
    descriptor: { deployment: structuredClone(deployment), profile: P.name, consumerKind: kind, job: key(14), computation: key(15), permit: key(16), owner, admin, quota: P.quota, effect,
      ...consumer, templateHex: template.toString('hex'), inputsHashHex: inputs.toString('hex'), queryStateHashHex: queryStateDigest(quota).toString('hex') } };
}

