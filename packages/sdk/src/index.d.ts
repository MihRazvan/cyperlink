export type Commitment = 'confirmed' | 'finalized';
export interface AccountEvidence { address: string; owner: string; executable: boolean; data: Uint8Array }
export interface AccountSnapshot { slot: number; commitment: Commitment; accounts: (AccountEvidence | null)[] }
export interface ReadOptions { minContextSlot?: number }
export interface ReadTransport { readAccounts(addresses: string[], options?: ReadOptions): Promise<AccountSnapshot> }
export interface Operation {
  profile: 'local-native-ct-v0';
  job: string; computation: string; permit: string; owner: string; admin: string; quota: string; effect: string;
  /** Decimal u64 SKU, exactly as authorized in the merchant action. */
  sku: string;
  /** Exact 520-byte queued template (1040 hexadecimal characters), retained from the authorized request. */
  templateHex: string;
  /** SHA256 of the authorized encrypted inputs, retained from the request. */
  inputsHashHex: string;
}
export type OperationStatus = 'unobserved' | 'queued' | 'authorized' | 'expired' | 'stale' | 'denied' | 'invalidated' | 'cancelled' | 'committed';
export type RecoveryAction = 'observe' | 'cancel-with-owner' | 'prepare-fresh-with-owner-and-admin' | 'submit-owner-signed-commit';
export interface Observation {
  status: OperationStatus; slot: number; commitment: Commitment; job: string; permit: string; effect: string;
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
export class EvidenceError extends Error {}
export function publicKeyBytes(address: string): Uint8Array;
export function publicKeyAddress(bytes: Uint8Array): string;
export function decodePermit(bytes: Uint8Array): Permit;
export function decodeJob(bytes: Uint8Array): Job;
export function decodeQuota(bytes: Uint8Array): Quota;
export function decodeMerchantEntitlement(bytes: Uint8Array): MerchantEntitlement;
export const INITIAL_PROFILE: Readonly<{ name: 'local-native-ct-v0'; auth: string; policy: string; merchant: string; quota: string }>;
export function validateOperation(operation: Operation): { template: Permit; sku: bigint; inputsHash: Uint8Array };
export function reconcileOperation(operation: Operation, snapshot: AccountSnapshot): Observation;
export class LocalRpcTransport implements ReadTransport {
  constructor(endpoint?: string, options?: { fetch?: typeof globalThis.fetch; commitment?: Commitment; timeoutMs?: number });
  readAccounts(addresses: string[], options?: ReadOptions): Promise<AccountSnapshot>;
}
export class OperationReader {
  constructor(transport: ReadTransport);
  observe(operation: Operation): Promise<Observation>;
}
