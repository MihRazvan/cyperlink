import { resolve } from 'node:path';
import { canonicalHash } from '../../policy-client/src/deployment.mjs';
import { acquireSessionLock, privateJson, saveState, sessionDirectory } from '../../local-client/src/private-store.mjs';
import { ServiceError, requireInput, validId, exactObject } from './errors.mjs';
import { connectLocalBackend } from './backend.mjs';
import { projectConfigHash, operationConfigHash } from './config.mjs';

const now = () => new Date().toISOString();
const hash = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const pick = (value, keys) => structuredClone(Object.fromEntries(keys.filter(key => value?.[key] !== undefined).map(key => [key, value[key]])));
const projectKeys = ['name', 'release', 'profile', 'genesis', 'deploymentHash', 'network'];
const observationKeys = ['status', 'slot', 'commitment', 'job', 'permit', 'effect', 'consumerKind', 'licenseExpirySlot', 'licenseActive', 'quotaVersion', 'expectedQuotaVersion', 'minContextSlot'];
const deliveryKeys = ['status', 'signature', 'wireSha256', 'role', 'attempts', 'canBroadcast', 'observationSlot'];
const slot = value => Number.isSafeInteger(value) && value >= 0;
function publicResult(result) {
  requireInput(result && typeof result === 'object', 'Invalid SDK result.');
  const observation = pick(result.observation, observationKeys);
  requireInput(typeof observation.status === 'string' && (observation.status === 'unresolved' || slot(observation.slot)), 'Invalid SDK observation.');
  // Reasons, arbitrary RPC errors and tickets can contain local diagnostics. The
  // service deliberately exposes a narrower contract than the in-process SDK.
  const output = { observation };
  if (result.delivery) {
    output.delivery = pick(result.delivery, deliveryKeys);
    if (result.delivery.receipt) output.delivery.receipt = pick(result.delivery.receipt, ['slot', 'landedCU', 'feeLamports']);
  }
  return output;
}
function projectView(project) { return pick(project, ['id', 'createdAt', ...projectKeys]); }
function operationView(op) { return pick(op, ['id', 'projectId', 'planHash', 'consumerKind', 'createdAt', 'updatedAt', 'minimumSlot', 'paymentCommitted', 'observation', 'deliveries', 'lastError']); }

/** Durable metadata around verified SDK operations, with no transaction authority.
 * Configuration aliases are local operator input, never paths supplied by HTTP.
 * A single writer lock and serialized copy-on-write commits survive graceful
 * restart and reject ambiguous concurrent process ownership after a hard crash.
 */
export class ProjectService {
  static async open({ directory, sources, connect = connectLocalBackend }) {
    requireInput(sources && typeof sources === 'object' && !Array.isArray(sources), 'Configure local project sources.');
    for (const [id, source] of Object.entries(sources)) {
      requireInput(validId(id), 'Invalid configured project source.');
      exactObject(source, ['instancePath', 'workspaceDirectory', ...(Object.hasOwn(source, 'operationSources') ? ['operationSources'] : [])]);
      requireInput(typeof source.instancePath === 'string' && typeof source.workspaceDirectory === 'string', 'Configure explicit local paths.');
      if (source.operationSources !== undefined) {
        requireInput(source.operationSources && typeof source.operationSources === 'object' && !Array.isArray(source.operationSources), 'Configure operation source aliases.');
        for (const [reference, operation] of Object.entries(source.operationSources)) {
          requireInput(validId(reference), 'Invalid configured operation reference.');
          exactObject(operation, ['directory', 'approvalsDirectory']);
          requireInput(typeof operation.directory === 'string' && typeof operation.approvalsDirectory === 'string', 'Configure explicit operation and approval paths.');
        }
      }
    }
    directory = await sessionDirectory(directory);
    const lock = await acquireSessionLock(directory), path = resolve(directory, 'service.json');
    try {
      let state;
      try { state = await privateJson(path); }
      catch (error) { if (error.code !== 'ENOENT') throw error; state = { schema: 2, projects: [], operations: [] }; }
      requireInput([1, 2].includes(state.schema) && Array.isArray(state.projects) && Array.isArray(state.operations), 'Invalid retained service state.');
      const legacy = state.schema === 1;
      const projectIds = new Set(), operationIds = new Set();
      for (const project of state.projects) {
        requireInput(validId(project.id) && validId(project.source) && !projectIds.has(project.id) && hash(project.configHash) && hash(project.deploymentHash) && hash(project.release), 'Invalid retained project identity.');
        if (legacy) {
          requireInput(Object.hasOwn(sources, project.source) && canonicalHash(sources[project.source]) === project.configHash,
            'Restore the original complete source configuration before migrating the retained service registry.');
          project.configHash = projectConfigHash(sources[project.source]);
        }
        projectIds.add(project.id);
      }
      for (const op of state.operations) {
        const key = `${op.projectId}/${op.id}`;
        requireInput(validId(op.id) && validId(op.reference) && !operationIds.has(key) && projectIds.has(op.projectId) && hash(op.planHash) && slot(op.minimumSlot) && typeof op.paymentCommitted === 'boolean', 'Invalid retained operation identity.');
        if (legacy) {
          const project = state.projects.find(value => value.id === op.projectId);
          op.sourceHash = operationConfigHash(sources[project.source], op.reference);
        }
        requireInput(hash(op.sourceHash), 'Invalid retained operation source identity.');
        operationIds.add(key);
      }
      const service = new this({ directory, path, sources: structuredClone(sources), connect, lock, state });
      if (legacy) { state.schema = 2; await service.commit(state); }
      return service;
    } catch (error) { await lock.release(); throw error; }
  }
  constructor(options) { Object.assign(this, options); this.backends = new Map(); this.queue = Promise.resolve(); this.closed = false; }
  serialized(work) {
    if (this.closed) return Promise.reject(new ServiceError('SERVICE_CLOSED', 'Service is closing.', 503));
    const result = this.queue.then(work);
    this.queue = result.catch(() => {});
    return result;
  }
  async commit(state) {
    // The private artifact reader has an 8 MiB bound. Never publish a registry
    // that this same service could not read after restart (including formatting).
    if (Buffer.byteLength(JSON.stringify(state, null, 2)) >= 8 * 1024 * 1024) throw new ServiceError('STORAGE_LIMIT', 'Local service storage limit reached. Preserve the retained registry.', 507);
    await saveState(this.path, state); this.state = state;
  }
  source(alias) {
    if (!Object.hasOwn(this.sources, alias)) throw new ServiceError('SOURCE_NOT_CONFIGURED', 'Project source is not configured.', 404);
    return this.sources[alias];
  }
  project(id) {
    const project = this.state.projects.find(value => value.id === id);
    if (!project) throw new ServiceError('PROJECT_NOT_FOUND', 'Project not found.', 404);
    return project;
  }
  operation(projectId, id) {
    this.project(projectId);
    const op = this.state.operations.find(value => value.projectId === projectId && value.id === id);
    if (!op) throw new ServiceError('OPERATION_NOT_FOUND', 'Operation not found.', 404);
    return op;
  }
  async backend(project) {
    const source = this.source(project.source);
    requireInput(projectConfigHash(source) === project.configHash, 'Project configuration changed. Restore the original source configuration.');
    if (!this.backends.has(project.id)) {
      const backend = await this.connect(source);
      requireInput(canonicalHash(pick(backend.project, projectKeys)) === canonicalHash(pick(project, projectKeys)), 'Configured deployment identity changed.');
      this.backends.set(project.id, backend);
    }
    return this.backends.get(project.id);
  }
  listProjects() { return this.state.projects.map(projectView); }
  getProject(id) { return projectView(this.project(id)); }
  listOperations(projectId) { this.project(projectId); return this.state.operations.filter(op => op.projectId === projectId).map(operationView); }
  getOperation(projectId, id) { return operationView(this.operation(projectId, id)); }
  register(input) { return this.serialized(async () => {
    exactObject(input, ['id', 'source']); requireInput(validId(input.id) && validId(input.source), 'Invalid project identifier or source.');
    const source = this.source(input.source), configHash = projectConfigHash(source);
    const existing = this.state.projects.find(project => project.id === input.id);
    if (existing) {
      if (existing.source !== input.source || existing.configHash !== configHash) throw new ServiceError('IDENTITY_CONFLICT', 'Project ID already belongs to another source.');
      await this.backend(existing); return projectView(existing);
    }
    requireInput(this.state.projects.length < 100, 'Local project limit reached.');
    const backend = await this.connect(source), metadata = pick(backend.project, projectKeys);
    requireInput(hash(metadata.release) && hash(metadata.deploymentHash) && typeof metadata.genesis === 'string', 'Invalid verified deployment identity.');
    const project = { id: input.id, source: input.source, configHash, createdAt: now(), ...metadata };
    const state = structuredClone(this.state); state.projects.push(project); await this.commit(state);
    this.backends.set(project.id, backend); return projectView(project);
  }); }
  importOperation(projectId, input) { return this.serialized(async () => {
    exactObject(input, ['id', 'reference']); requireInput(validId(input.id) && validId(input.reference), 'Invalid operation identifier or reference.');
    const project = this.project(projectId), sourceHash = operationConfigHash(this.source(project.source), input.reference);
    const existing = this.state.operations.find(op => op.projectId === projectId && op.id === input.id);
    if (existing && (existing.reference !== input.reference || existing.sourceHash !== sourceHash)) throw new ServiceError('IDENTITY_CONFLICT', 'Operation ID already belongs to another retained source.');
    const aliasOwner = this.state.operations.find(op => op.projectId === projectId && op.reference === input.reference);
    if (aliasOwner && aliasOwner.sourceHash !== sourceHash) throw new ServiceError('IDENTITY_CONFLICT', 'An imported operation source was remapped. Restore its original configuration.');
    const backend = await this.backend(project);
    const identity = await backend.inspect(input.reference);
    requireInput(hash(identity.planHash) && slot(identity.contextSlot) && ['merchant', 'license'].includes(identity.consumerKind), 'Invalid verified operation identity.');
    if (existing) {
      if (existing.reference !== input.reference || existing.planHash !== identity.planHash) throw new ServiceError('IDENTITY_CONFLICT', 'Operation ID already belongs to another retained plan.');
      return operationView(existing);
    }
    if (this.state.operations.some(op => op.projectId === projectId && (op.reference === input.reference || op.planHash === identity.planHash))) throw new ServiceError('OPERATION_EXISTS', 'This operation is already imported under its original ID.');
    requireInput(this.state.operations.length < 5000, 'Local operation limit reached.');
    const op = { id: input.id, projectId, reference: input.reference, sourceHash, planHash: identity.planHash, consumerKind: identity.consumerKind,
      createdAt: now(), updatedAt: now(), minimumSlot: identity.contextSlot, paymentCommitted: false, observation: null, deliveries: {}, lastError: null };
    const state = structuredClone(this.state); state.operations.push(op); await this.commit(state); return operationView(op);
  }); }
  observe(projectId, id) { return this.reconcile(projectId, id); }
  recover(projectId, id, input) {
    exactObject(input, ['role']); requireInput(['query', 'commit'].includes(input.role), 'Recovery role must be query or commit.');
    return this.reconcile(projectId, id, input.role);
  }
  reconcile(projectId, id, role) { return this.serialized(async () => {
    const original = this.operation(projectId, id), project = this.project(projectId);
    const state = structuredClone(this.state), op = state.operations.find(value => value.projectId === projectId && value.id === id);
    try {
      requireInput(operationConfigHash(this.source(project.source), original.reference) === original.sourceHash, 'Imported operation source changed. Restore its original configuration.');
      const backend = await this.backend(project);
      const result = publicResult(await (role ? backend.recover(original.reference, original.planHash, original.minimumSlot, role)
        : backend.observe(original.reference, original.planHash, original.minimumSlot)));
      if (result.observation.status !== 'unresolved') requireInput(result.observation.slot >= op.minimumSlot, 'SDK observation regressed.');
      op.minimumSlot = Math.max(op.minimumSlot, result.observation.slot ?? 0, result.observation.minContextSlot ?? 0, result.delivery?.observationSlot ?? 0);
      requireInput(slot(op.minimumSlot), 'Invalid SDK observation floor.');
      op.observation = result.observation;
      if (result.observation.status === 'committed') op.paymentCommitted = true;
      if (role && result.delivery) op.deliveries[role] = result.delivery;
      op.lastError = null;
    } catch {
      op.observation = null;
      op.lastError = { code: 'OBSERVATION_UNAVAILABLE', message: 'Unable to verify the retained operation. No transaction was signed or submitted.' };
      op.updatedAt = now(); await this.commit(state);
      throw new ServiceError(op.lastError.code, op.lastError.message, 503);
    }
    op.updatedAt = now(); await this.commit(state); return operationView(op);
  }); }
  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    return this.closing = this.queue.then(() => this.lock.release());
  }
}
