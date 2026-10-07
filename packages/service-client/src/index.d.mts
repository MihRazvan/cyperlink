export interface RequestOptions { signal?: AbortSignal }
export interface Project {
  id: string; name: string; release: string; profile: string; genesis: string;
  deploymentHash: string; network: 'local'; createdAt: string;
}
export interface Observation {
  status: string; slot?: number; commitment?: 'confirmed' | 'finalized'; minContextSlot?: number;
  licenseActive?: boolean; licenseExpirySlot?: string; [field: string]: unknown;
}
export interface Delivery {
  status: string; signature: string; wireSha256: string; canBroadcast: boolean;
  role: 'query' | 'commit'; attempts: number; observationSlot: number;
  receipt?: { slot: number; landedCU?: number; feeLamports?: number };
}
export interface Operation {
  id: string; projectId: string; planHash: string; consumerKind: 'merchant' | 'license';
  createdAt: string; updatedAt: string; minimumSlot: number; paymentCommitted: boolean;
  observation: Observation | null; deliveries: Partial<Record<'query' | 'commit', Delivery>>;
  lastError: { code: string; message: string } | null;
}
export class CyperLinkServiceError extends Error {
  code: string; status?: number; requestId?: string;
  constructor(code: string, message: string, options?: { status?: number; requestId?: string; cause?: unknown });
}
export class CyperLinkServiceClient {
  constructor(options: { endpoint: string; token: string; timeoutMs?: number; fetch?: typeof fetch });
  listProjects(options?: RequestOptions): Promise<Project[]>;
  registerProject(input: { id: string; source: string }, options?: RequestOptions): Promise<Project>;
  getProject(project: string, options?: RequestOptions): Promise<Project>;
  listOperations(project: string, options?: RequestOptions): Promise<Operation[]>;
  importOperation(project: string, input: { id: string; reference: string }, options?: RequestOptions): Promise<Operation>;
  getOperation(project: string, operation: string, options?: RequestOptions): Promise<Operation>;
  observe(project: string, operation: string, options?: RequestOptions): Promise<Operation>;
  recover(project: string, operation: string, role: 'query' | 'commit', options?: RequestOptions): Promise<Operation>;
}
