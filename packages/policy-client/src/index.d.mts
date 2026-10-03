export type Commitment = 'confirmed' | 'finalized';
export interface AccountEvidence { address: string; owner: string; executable: boolean; data: Uint8Array }
export interface AccountSnapshot { slot: number; commitment: Commitment; accounts: (AccountEvidence | null)[] }
export interface ReadOptions { minContextSlot?: number }
export interface ReadTransport { readAccounts(addresses: string[], options?: ReadOptions): Promise<AccountSnapshot> }
export interface BaseOperation {
  profile: 'local-custom-policy-v1'; deployment: PolicyDeployment;
  job: string; computation: string; permit: string; owner: string; admin: string; quota: string; effect: string;
  /** Exact 712-byte queued template (1424 hexadecimal characters), retained from the authorized request. */
  templateHex: string;
  /** SHA256 of the authorized encrypted inputs, retained from the request. */
  inputsHashHex: string;
  /** Custom profile hashes the entire 353-byte state under its query domain. */
  queryStateHashHex: string;
}
export interface MerchantOperation extends BaseOperation {
  /** Explicit supported effect adapter. */
  consumerKind: 'merchant';
  /** Decimal u64 SKU, exactly as authorized in the merchant action. */
  sku: string;
}
export interface LicenseOperation extends BaseOperation {
  consumerKind: 'license';
  /** Exact 32-byte product identifier (64 hexadecimal characters). */
  productHex32: string;
  /** Decimal u64 slot bound into the authorized license action. */
  licenseExpirySlot: string;
}
export type Operation = MerchantOperation | LicenseOperation;
export type OperationStatus = 'unobserved' | 'queued' | 'authorized' | 'expired' | 'stale' | 'denied' | 'invalidated' | 'cancelled' | 'committed';
export type RecoveryAction = 'observe' | 'cancel-with-owner' | 'prepare-fresh-with-owner-and-admin' | 'submit-owner-signed-commit';
export interface Observation {
  status: OperationStatus; slot: number; commitment: Commitment; job: string; permit: string; effect: string;
  consumerKind: 'merchant' | 'license'; licenseExpirySlot?: string; licenseActive?: boolean;
  quotaVersion: string; expectedQuotaVersion: string; actions: RecoveryAction[]; reason?: string;
}
export interface Permit {
  release: Uint8Array; schema: Uint8Array; domain: Uint8Array; successorCiphertexts: Uint8Array;
  bytes: Uint8Array; empty: boolean; state: number; decision: number; quotaVersion: bigint;
  previousHash: Uint8Array; successorHash: Uint8Array; source: string; mint: string; destination: string; owner: string;
  sourceHash: Uint8Array; nativeHash: Uint8Array; newSourceCiphertext: Uint8Array; amountCommitment: Uint8Array;
  quota: string; consumer: string; actionDigest: Uint8Array; successorNonce: bigint; successorCiphertext: Uint8Array; expiry: bigint;
}
export interface Job {
  kind: number; status: number; owner: string; computation: string; permit: string;
  nonce: bigint; expiry: bigint; template: Permit; inputsHash: Uint8Array;
}
export interface Quota { release: Uint8Array; schema: Uint8Array; domain: Uint8Array; version: bigint; hash: Uint8Array; nonce: bigint; ciphertexts: Uint8Array; counter: bigint; admin: string; initialized: boolean }
export type MerchantEntitlement = { issued: false } | { issued: true; owner: string; sku: bigint };
export type LicenseEntitlement = { issued: false } | { issued: true; owner: string; product: Uint8Array; expirySlot: bigint };
export class EvidenceError extends Error {}
export function publicKeyBytes(address: string): Uint8Array;
export function publicKeyAddress(bytes: Uint8Array): string;
export function decodePermit(bytes: Uint8Array): Permit;
export function decodeJob(bytes: Uint8Array): Job;
export function decodeQuota(bytes: Uint8Array): Quota;
export function decodeMerchantEntitlement(bytes: Uint8Array): MerchantEntitlement;
export function decodeLicenseEntitlement(bytes: Uint8Array): LicenseEntitlement;
export interface ValidatedOperation {
  template: Permit; sku?: bigint; inputsHash: Uint8Array;
  consumer: {kind: 'merchant'; sku: bigint; ownerProgram: string; effectSize: 49}
    | {kind: 'license'; product: Uint8Array; expirySlot: bigint; ownerProgram: string; effectSize: 81};
}
export function validateOperation(operation: Operation): ValidatedOperation;
export function reconcileOperation(operation: Operation, snapshot: AccountSnapshot): Observation;
export class LocalRpcTransport implements ReadTransport {
  constructor(endpoint?: string, options?: { fetch?: typeof globalThis.fetch; commitment?: Commitment; timeoutMs?: number });
  readAccounts(addresses: string[], options?: ReadOptions): Promise<AccountSnapshot>;
}
export class OperationReader {
  constructor(transport: ReadTransport);
  observe(operation: Operation): Promise<Observation>;
}

/** Node Buffer is accepted wherever Uint8Array is specified. Addresses are raw 32-byte keys. */
export interface ConsumerDigestAddresses {
  effect: Uint8Array; owner: Uint8Array; destination: Uint8Array; mint: Uint8Array;
}
/** Avoid JavaScript number rounding: unsigned u64 is bigint or a canonical decimal string. */
export type UnsignedU64 = bigint | string;
export function buildMerchantDigest(input: ConsumerDigestAddresses & { sku: UnsignedU64 }): Uint8Array;
export function buildLicenseDigest(input: ConsumerDigestAddresses & { product: Uint8Array; expirySlot: UnsignedU64 }): Uint8Array;
export interface ActionTemplateInput {
  /** Raw 32-byte public keys. */
  source: Uint8Array; mint: Uint8Array; destination: Uint8Array; owner: Uint8Array;
  quota: Uint8Array; consumer: Uint8Array;
  /** Complete current native source account bytes and exact native instruction data. */
  sourceData: Uint8Array; nativeData: Uint8Array;
  /** Equality, grouped, range in that order: keys32 and complete verified-context account data. */
  proofKeys: [Uint8Array, Uint8Array, Uint8Array];
  proofData: [Uint8Array, Uint8Array, Uint8Array];
  /** New source ciphertext64, amount commitment32, semantic consumer digest32. */
  newSource: Uint8Array; commitment: Uint8Array; consumerContract: Uint8Array;
}
/** Returns the immutable 464-byte prepare-action input, not the queued 520-byte Job template. */
export function buildActionTemplate(input: ActionTemplateInput): Uint8Array;
export interface PolicyDeployment {
 schema: 1; profile: 'local-custom-policy-v1'; cipher: 'cspl-rescue-scalar253-v1';
 releaseHashHex: string; schemaHashHex: string; domainHashHex: string; mxePublicKeyHex: string;
 genesisHash: string; quota: string; stateFields: {name:string;type:'u64'}[];
 programs: {auth:string;policy:string;guard:string;kernel:string;merchant:string;license:string;proofBuffer:string};
 [metadata: string]: unknown;
}
export function validateDeployment(deployment: PolicyDeployment): PolicyDeployment;
export function canonicalHash(value: unknown): string;
export function policyDomainHash(deployment: PolicyDeployment): string;
export function deploymentProfile(deployment: PolicyDeployment): PolicyDeployment['programs'] & {name:'local-custom-policy-v1';quota:string};
export interface LocalSigner { publicKey: { toBase58(): string }; secretKey: Uint8Array }
export interface InstructionRecord { program: string; data: string; accounts: { key: string; signer: boolean; writable: boolean }[] }
export interface OperationPlan {
  schema: 1; label: string; genesisHash: string; contextSlot: number; action: string;
  descriptor: Operation & { queryStateHashHex: string };
  quotaSnapshotHex: string; mxePublicKeyHex: string;
  query: { offset: string; expiry: string; publicKeyHex: string; clientNonceHex: string; amountCiphertextHex: string; openingCiphertextHex: string };
  binding: { nativeDataHex: string; sourceDataHex: string; proofAddresses: string[]; proofDataHex: string[] };
  instructions: { query: InstructionRecord; commit: InstructionRecord };
}
export interface SignedTicket {
  schemaVersion: 1; journalDirectory: string; genesisHash: string; signature: string; wireSha256: string;
  role: 'query' | 'commit'; descriptorSha256: string; simulatedCU?: number;
}
export interface TransactionReceipt {
  label: string; category: string; signature: string; bytes: number; slot: number; signaturesVerified: true;
  simulatedCU?: number; landedCU: number; feeLamports: number; error: unknown; transaction: unknown;
}
export interface Delivery {
  status: 'delivery-unavailable' | 'prepared' | 'pending' | 'landed' | 'failed' | 'observed-without-receipt' | 'expired-unresolved' | 'simulation-required' | 'simulation-rejected';
  signature: string; attempts: number; canBroadcast: boolean; result?: TransactionReceipt;
}
export class PolicyOperationClient {
  static connect(options: { deployment: PolicyDeployment; moduleRoot: string; endpoint: string; payerKeyfile: string; directory: string; idl: string; proofCli: string; record?: (receipt: TransactionReceipt) => Promise<void> }): Promise<PolicyOperationClient>;
  prepare(options: { label: string; directory: string; provisionedDirectory: string; amount: number;
    consumer: { kind: 'merchant'; sku: string } | { kind: 'license'; productHex32: string; expirySlot: string } }): Promise<OperationPlan>;
  load(directory: string): Promise<OperationPlan>;
  observe(plan: OperationPlan): Promise<Observation>;
  stageQuery(plan: OperationPlan, signers: { owner: LocalSigner }): Promise<SignedTicket>;
  stageCommit(plan: OperationPlan, signers: { owner: LocalSigner }): Promise<SignedTicket>;
  submit(plan: OperationPlan, ticket: SignedTicket): Promise<TransactionReceipt>;
  recover(plan: OperationPlan, ticket: SignedTicket): Promise<{ delivery: Delivery; observation: Observation }>;
}
export function readOperationPlan(filename: string): Promise<OperationPlan>;
export function validateOperationPlan(plan: OperationPlan): OperationPlan;
export function descriptorDigest(descriptor: Operation): string;
export function queryStateDigest(data: Uint8Array): Uint8Array;

export interface ApprovalSigners { ownerKeyfile: string; administratorKeyfile: string }
export interface PolicySessionOptions {
  deployment: PolicyDeployment; moduleRoot: string; endpoint: string;
  directory: string; idl: string; proofCli: string;
}
export interface SessionDelivery extends Delivery {
  wireSha256: string; role: 'query' | 'commit';
  observationSlot: number; availability: RpcAvailability[];
  receipt?: { slot: number; error: unknown; landedCU: number; feeLamports: number };
}
export interface RpcAvailability { method: string; category: 'network' | 'http'; status?: number; code?: string }
export interface UnresolvedObservation { status: 'unresolved'; reason: string; minContextSlot: number; availability: RpcAvailability }
export interface SessionRecovery { ticket: SignedTicket; delivery: SessionDelivery; observation: Observation | UnresolvedObservation }
/** Local keyless observation/recovery; explicit owner/admin keys only at prepare/stage. */
export class PolicySession {
  static connect(options: PolicySessionOptions): Promise<PolicySession>;
  prepare(options: Parameters<PolicyOperationClient['prepare']>[0], signers: ApprovalSigners): Promise<OperationPlan>;
  load(directory: string): Promise<OperationPlan>;
  observe(plan: OperationPlan): Promise<Observation>;
  stageQuery(plan: OperationPlan, signers: ApprovalSigners): Promise<SignedTicket>;
  stageCommit(plan: OperationPlan, signers: ApprovalSigners): Promise<SignedTicket>;
  discoverApproval(plan: OperationPlan, role: 'query' | 'commit'): Promise<SignedTicket>;
  recover(plan: OperationPlan, role: 'query' | 'commit'): Promise<SessionRecovery>;
  submit(plan: OperationPlan, role: 'query' | 'commit'): Promise<SessionRecovery>;
}
