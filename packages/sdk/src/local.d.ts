import type { Operation, Observation } from './index.js';
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
  status: 'prepared' | 'pending' | 'landed' | 'failed' | 'observed-without-receipt' | 'expired-unresolved' | 'simulation-required' | 'simulation-rejected';
  signature: string; attempts: number; canBroadcast: boolean; result?: TransactionReceipt;
}
export class LocalOperationClient {
  static connect(options: { moduleRoot: string; endpoint: string; payerKeyfile: string; directory: string; idl: string; proofCli: string; record?: (receipt: TransactionReceipt) => Promise<void> }): Promise<LocalOperationClient>;
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
