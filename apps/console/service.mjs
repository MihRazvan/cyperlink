import { resolve } from 'node:path';
import { canonicalHash } from '../../packages/policy-client/src/deployment.mjs';
import { privateJson, saveState, sessionDirectory } from '../../packages/local-client/src/private-store.mjs';

export class ConsoleError extends Error {
  constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}
const assertInput = (condition, message) => { if (!condition) throw new ConsoleError('INVALID_INPUT', message, 422); };
const idPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const roles = { 'approve-query': 'query', 'approve-payment': 'commit', 'recover-query': 'query', 'recover-payment': 'commit', 'submit-query': 'query', 'submit-payment': 'commit' };
const now = () => new Date().toISOString();
const u64 = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,19})$/.test(value) && BigInt(value) <= 0xffffffffffffffffn;
const terminalUnpaid = new Set(['stale', 'denied', 'expired', 'invalidated', 'cancelled']);
export function validatePurchase(input) {
  assertInput(input && input.consent === 'prepare-native', 'Explicit native preparation approval is required.');
  assertInput(idPattern.test(input.requestId), 'A unique request ID is required.');
  assertInput(typeof input.title === 'string' && input.title.trim().length >= 1 && input.title.trim().length <= 80, 'Use a purchase title of 1–80 characters.');
  assertInput(['a', 'b'].includes(input.sourceId), 'Select a configured wallet.');
  assertInput(typeof input.amount === 'string' && /^[1-9][0-9]{0,14}$/.test(input.amount) && BigInt(input.amount) < 2n ** 48n, 'Amount must be a positive whole number below 2^48.');
  const c = input.consumer;
  assertInput(c && ['merchant', 'license'].includes(c.kind), 'Select a supported application effect.');
  let consumer;
  if (c.kind === 'merchant') {
    assertInput(u64(c.sku), 'SKU must be a canonical unsigned 64-bit integer.'); consumer = { kind: 'merchant', sku: c.sku };
  } else {
    assertInput(typeof c.productHex32 === 'string' && /^[0-9a-f]{64}$/.test(c.productHex32) && u64(c.expirySlot), 'Use a 32-byte lowercase hex product and an unsigned expiry slot.');
    consumer = { kind: 'license', productHex32: c.productHex32, expirySlot: c.expirySlot };
  }
  return { id: input.requestId, title: input.title.trim(), amount: input.amount, sourceId: input.sourceId, consumer };
}
function businessKey(op) { return `${op.sourceId}:${op.consumer.kind}:${op.consumer.sku ?? op.consumer.productHex32}`; }
function safeError(error) {
  if (error instanceof ConsoleError) return { code: error.code, message: error.message };
  const messages = {
    APPROVAL_INTERRUPTED_BEFORE_SIGNED_RECORD: 'Approval stopped before its signed record was saved. Automatic replacement is blocked.',
    APPROVAL_AMBIGUOUS: 'Multiple signing records need local inspection. No replacement will be signed.',
    PREPARATION_INCOMPLETE: 'Preparation was interrupted. Refresh can find a completed plan; automatic preparation retry is blocked.',
    PREPARATION_ALREADY_STARTED: 'This preparation already started. Recover its retained operation instead of repeating it.',
  };
  if (messages[error.code]) return { code: error.code, message: messages[error.code] };
  return { code: 'ACTION_UNRESOLVED', message: 'Unable to verify this action. Retained records are preserved. Refresh or recover before deciding what to do next.' };
}
function projectView(p) {
  return { name: p.name, release: p.release, profile: p.profile, network: p.network, genesis: p.genesis,
    signingEnabled: p.signingEnabled, administratorConfigured: p.administratorConfigured, slot: p.slot,
    sources: p.sources.map(s => ({ id: s.id, label: s.label, canSign: s.canSign })) };
}
/** One local project; durable intent precedes work. Nothing resumes signing on startup. */
export class ConsoleService {
  static async open({ directory, adapter }) {
    directory = await sessionDirectory(directory);
    const path = resolve(directory, 'console.json'), identity = canonicalHash({ release: adapter.project.release, genesis: adapter.project.genesis, deployment: adapter.project.deploymentHash });
    let state;
    try { state = await privateJson(path); }
    catch (error) { if (error.code !== 'ENOENT') throw error; state = { schema: 1, identity, operations: [] }; }
    assertInput(state.schema === 1 && state.identity === identity && Array.isArray(state.operations) && state.operations.length <= 500, 'Workspace belongs to a different deployment or has invalid records.');
    const ids = new Set();
    for (const op of state.operations) {
      const expected = validatePurchase({ ...op, requestId: op.id, consent: 'prepare-native' });
      assertInput(!ids.has(op.id) && canonicalHash(expected) === op.requestHash, 'Workspace operation identity changed.'); ids.add(op.id);
      if (op.busy) { op.busy = false; op.phase = 'interrupted'; op.error = { code: 'PROCESS_INTERRUPTED', message: 'The previous process stopped. Recover the retained operation; no action has been repeated.' }; }
    }
    const service = new this({ directory, path, adapter, state }); await service.save(); return service;
  }
  constructor(options) { Object.assign(this, options); this.busy = false; this.saving = Promise.resolve(); }
  save() { this.state.updatedAt = now(); const value = structuredClone(this.state); this.saving = this.saving.then(() => saveState(this.path, value)); return this.saving; }
  canSign(op) { return this.adapter.project.administratorConfigured && this.adapter.project.sources.some(s => s.id === op.sourceId && s.canSign); }
  actions(op) {
    if (this.busy || op.busy) return [];
    const actions = ['refresh'];
    if (!op.planHash) return actions;
    if (op.approvals.query) actions.push('recover-query');
    if (op.approvals.commit) actions.push('recover-payment');
    if (op.error || op.paymentCommitted) return actions;
    if (this.canSign(op) && !op.approvals.query) actions.push('approve-query');
    if (this.canSign(op) && op.observation?.status === 'authorized' && !op.approvals.commit) actions.push('approve-payment');
    for (const [role, action] of [['query', 'submit-query'], ['commit', 'submit-payment']]) {
      const d = op.deliveries[role];
      if (op.approvals[role] && d && (d.canBroadcast || d.status === 'simulation-required')) actions.push(action);
    }
    return actions;
  }
  projection() {
    return { project: projectView(this.adapter.project), busy: this.busy, updatedAt: this.state.updatedAt,
      operations: this.state.operations.map(op => ({ id: op.id, title: op.title, amount: op.amount, sourceId: op.sourceId,
        consumer: op.consumer, createdAt: op.createdAt, phase: op.phase, busy: op.busy, planHash: op.planHash,
        paymentCommitted: op.paymentCommitted, observation: op.observation, deliveries: op.deliveries, error: op.error, actions: this.actions(op) })) };
  }
  apply(op, result) {
    if (result.planHash) { assertInput(!op.planHash || op.planHash === result.planHash, 'Retained operation plan changed.'); op.planHash = result.planHash; }
    if (result.observation) { op.observation = result.observation; if (op.observation.status === 'committed') op.paymentCommitted = true; }
    op.phase = op.observation?.status ?? 'prepared';
  }
  async launch(op, phase, work) {
    if (this.busy || this.refreshing) throw new ConsoleError('WORKSPACE_BUSY', 'Wait for the current project action to finish.');
    this.busy = true; op.busy = true; op.phase = phase; op.error = null;
    try { await this.save(); }
    catch (error) { this.busy = false; op.busy = false; throw error; }
    this.task = (async () => {
      try { await work(); }
      catch (error) {
        op.error = safeError(error); op.phase = 'unresolved';
        // Private diagnostics never leave the local machine through the product API.
        await saveState(resolve(this.directory, `${op.id}-last-error.json`), { code: error.code, message: error.message, stack: error.stack }).catch(() => {});
      } finally { op.busy = false; this.busy = false; await this.save(); }
    })();
    // Keep failed persistence visible to close/drain without an unhandled rejection.
    this.task.catch(() => {});
    return this.projection();
  }
  async prepare(input) {
    const request = validatePurchase(input), requestHash = canonicalHash(request);
    const existing = this.state.operations.find(op => op.id === request.id);
    if (existing) { assertInput(existing.requestHash === requestHash, 'Request ID already belongs to a different purchase.'); return this.projection(); }
    if (this.busy || this.refreshing) throw new ConsoleError('WORKSPACE_BUSY', 'Wait for the current project action to finish.');
    assertInput(this.canSign(request), 'Configure the selected owner and administrator locally before preparing.');
    assertInput(this.state.operations.length < 500, 'Workspace operation limit reached; preserve it and use a new workspace.');
    const conflict = this.state.operations.find(op => businessKey(op) === businessKey(request) && (op.paymentCommitted || !terminalUnpaid.has(op.observation?.status)));
    if (conflict) throw new ConsoleError('PURCHASE_EXISTS', 'This purchase already has a retained operation. Recover it before creating another.');
    const op = { ...request, requestHash, createdAt: now(), phase: 'preparing', busy: false, approvals: {}, deliveries: {}, observation: null, error: null, paymentCommitted: false };
    this.state.operations.push(op);
    return this.launch(op, 'preparing', async () => this.apply(op, await this.adapter.prepare(op)));
  }
  async act(id, action, input) {
    const op = this.state.operations.find(value => value.id === id);
    if (!op) throw new ConsoleError('NOT_FOUND', 'Purchase not found.', 404);
    assertInput(input?.consent === action, 'Explicit approval of this action is required.');
    assertInput((op.planHash ?? null) === (input.planHash ?? null), 'The displayed purchase changed. Refresh before approval.');
    if (!this.actions(op).includes(action)) throw new ConsoleError('ACTION_NOT_AVAILABLE', 'This action is unavailable for the current purchase. Refresh or recover it.');
    const role = roles[action];
    return this.launch(op, action, async () => {
      if (action === 'refresh') { this.apply(op, await this.adapter.inspect(op)); return; }
      if (action.startsWith('approve-')) {
        if (role === 'commit') {
          this.apply(op, { observation: await this.adapter.observe(op) });
          if (op.observation.status !== 'authorized') throw new ConsoleError('AUTHORIZATION_CHANGED', 'Authorization is no longer current. No payment was signed.');
        }
        op.approvals[role] = true; await this.save(); // durable intent before stage/sign
      }
      const result = action.startsWith('approve-') ? await this.adapter.approve(op, role) : await this.adapter.recover(op, role, action.startsWith('submit-'));
      op.deliveries[role] = result.delivery; this.apply(op, result);
    });
  }
  async refresh() {
    if (this.busy) return this.projection();
    if (this.refreshing) { await this.refreshing; return this.projection(); }
    // A GET may read state, never discover a ticket, prepare or submit work.
    this.refreshing = (async () => {
      await this.adapter.refreshProject?.();
      for (const op of this.state.operations) {
        if (!op.planHash) continue;
        try { this.apply(op, { observation: await this.adapter.observe(op) }); }
        catch (error) { op.observation = null; op.error = safeError(error); }
      }
      await this.save();
    })();
    try { await this.refreshing; } finally { this.refreshing = null; }
    return this.projection();
  }
  async close() { await this.task; await this.refreshing; await this.saving; }
}
