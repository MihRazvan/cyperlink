export type ApprovalRole = 'query' | 'commit';
export interface OperationSource { directory: string; approvalsDirectory: string }
export interface ProjectSource {
  instancePath: string;
  workspaceDirectory: string;
  operationSources?: Record<string, OperationSource>;
}
export interface Project {
  id: string; name: string; release: string; profile: string; genesis: string;
  deploymentHash: string; network: 'local'; createdAt: string;
}
export interface Observation {
  status: string; slot?: number; commitment?: 'confirmed' | 'finalized';
  job?: string; permit?: string; effect?: string; consumerKind?: 'merchant' | 'license';
  licenseExpirySlot?: string; licenseActive?: boolean; quotaVersion?: string;
  expectedQuotaVersion?: string; minContextSlot?: number;
}
export interface Delivery {
  status: string; signature: string; wireSha256: string; role: ApprovalRole;
  attempts: number; canBroadcast: boolean; observationSlot: number;
  receipt?: { slot: number; landedCU?: number; feeLamports?: number };
}
export interface Operation {
  id: string; projectId: string; planHash: string; consumerKind: 'merchant' | 'license';
  createdAt: string; updatedAt: string; minimumSlot: number; paymentCommitted: boolean;
  observation: Observation | null; deliveries: Partial<Record<ApprovalRole, Delivery>>;
  lastError: { code: string; message: string } | null;
}
export interface ServiceOptions { directory: string; sources: Record<string, ProjectSource> }
export interface LocalBackend {
  project: Omit<Project, 'id' | 'createdAt'>;
  inspect(reference: string): Promise<{ planHash: string; consumerKind: 'merchant' | 'license'; contextSlot: number }>;
  observe(reference: string, hash: string, minimumSlot: number): Promise<{ observation: Observation }>;
  recover(reference: string, hash: string, minimumSlot: number, role: ApprovalRole): Promise<{ observation: Observation; delivery: Delivery }>;
}
export class ServiceError extends Error { code: string; status: number; constructor(code: string, message: string, status?: number) }
export class ProjectService {
  static open(options: ServiceOptions): Promise<ProjectService>;
  listProjects(): Project[];
  getProject(id: string): Project;
  register(input: { id: string; source: string }): Promise<Project>;
  listOperations(projectId: string): Operation[];
  getOperation(projectId: string, id: string): Operation;
  importOperation(projectId: string, input: { id: string; reference: string }): Promise<Operation>;
  observe(projectId: string, id: string): Promise<Operation>;
  recover(projectId: string, id: string, input: { role: ApprovalRole }): Promise<Operation>;
  close(): Promise<boolean>;
}
export function connectLocalBackend(source: ProjectSource): Promise<LocalBackend>;
export function createServiceServer(service: ProjectService, options: { token: string }): import('node:http').Server;
export function startService(options: ServiceOptions & { port?: number; token: string }): Promise<{
  service: ProjectService; server: import('node:http').Server; close(): Promise<void>; url: string;
}>;
