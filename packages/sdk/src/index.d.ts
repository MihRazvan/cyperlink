export type Commitment = 'confirmed' | 'finalized';
export interface AccountEvidence { address: string; owner: string; executable: boolean; data: Uint8Array }
export interface AccountSnapshot { slot: number; commitment: Commitment; accounts: (AccountEvidence | null)[] }
export interface ReadOptions { minContextSlot?: number }
export interface ReadTransport { readAccounts(addresses: string[], options?: ReadOptions): Promise<AccountSnapshot> }
export interface BaseOperation {
  profile: 'local-native-ct-v0';
  job: string; computation: string; permit: string; owner: string; admin: string; quota: string; effect: string;
  /** Exact 520-byte queued template (1040 hexadecimal characters), retained from the authorized request. */
  templateHex: string;
  /** SHA256 of the authorized encrypted inputs, retained from the request. */
  inputsHashHex: string;
}
export interface MerchantOperation extends BaseOperation {
  /** Omission retains the original merchant-only API behavior. */
  consumerKind?: 'merchant';
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
  bytes: Uint8Array; empty: boolean; state: number; decision: number; quotaVersion: bigint;
  previousHash: Uint8Array; successorHash: Uint8Array; source: string; mint: string; destination: string; owner: string;
  sourceHash: Uint8Array; nativeHash: Uint8Array; newSourceCiphertext: Uint8Array; amountCommitment: Uint8Array;
  quota: string; consumer: string; actionDigest: Uint8Array; successorNonce: bigint; successorCiphertext: Uint8Array; expiry: bigint;
}
export interface Job {
  kind: number; status: number; owner: string; computation: string; permit: string;
  nonce: bigint; expiry: bigint; template: Permit; inputsHash: Uint8Array;
}
export interface Quota { version: bigint; hash: Uint8Array; nonce: bigint; ciphertext: Uint8Array; counter: bigint; admin: string; initialized: boolean }
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
export const INITIAL_PROFILE: Readonly<{ name: 'local-native-ct-v0'; auth: string; policy: string; merchant: string; license: string; quota: string }>;
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
