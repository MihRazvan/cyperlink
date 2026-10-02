import { createHash, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { privateJson, saveState, sessionDirectory } from './store.mjs';
import { ensure, writeNew } from '../../packages/local-client/src/runtime.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const terminal = new Set(['committed', 'denied', 'stale', 'expired', 'cancelled', 'invalidated']);
export const approvalDigest = (op, role) => digest(['cyperlink-local-human-approval-v1', role, op.id, op.amount, op.consumer, op.planHash]);
export function phaseOf(op) {
  if (op.queryDraftStale) return 'stale';
  if (op.interrupted) return 'unresolved-delivery';
  if (op.delivery?.status === 'response-lost' || op.delivery?.status === 'expired-unresolved') return 'unresolved-delivery';
  const status = op.observation?.status;
  if (terminal.has(status)) return status === 'invalidated' ? 'expired' : status;
  if (status === 'queued') return 'private-computation';
  if (status === 'authorized') return op.finalReview ? 'awaiting-final-approval' : 'authorized';
  if (op.tickets?.query) return 'unresolved-delivery';
  return op.planHash ? 'awaiting-query-approval' : op.error ? 'error' : 'preparing';
}

/** Local client orchestration; adapter uses real SDK, tests explicitly supply a host fake. */
export class ApprovalsService {
  static async open({ directory, bootstrap, adapter }) {
    directory = await sessionDirectory(directory);
    const filename = resolve(directory, 'state.json'); let state;
    try { state = await privateJson(filename); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      state = { schema: 1, id: randomUUID(), genesis: bootstrap.genesisHash, bootstrap: resolve(bootstrap.bootstrapDirectory), operations: [], events: [] };
    }
    ensure(state.schema === 1 && state.genesis === bootstrap.genesisHash && state.bootstrap === resolve(bootstrap.bootstrapDirectory), 'Session belongs to different bootstrap/ledger');
    const service = new this({ directory, filename, bootstrap, adapter, state });
    for (const op of state.operations) {
      // Never resume signing or preparation automatically after a process stops.
      if (op.inFlight) { op.interrupted = op.inFlight; delete op.inFlight; }
      if (!op.planHash && op.interrupted === 'prepare' && adapter.loadCompletedPreparation) {
        const complete = await adapter.loadCompletedPreparation(op);
        if (complete) { Object.assign(op, complete); delete op.interrupted; }
      }
      if (op.planHash) await adapter.validateRetained(op);
    }
    await service.save(); return service;
  }
  constructor(options) { Object.assign(this, options); this.busy = null; this.task = null; this.refreshing = null; }
  save() {
    const snapshot = structuredClone(this.state);
    this.saving = (this.saving ?? Promise.resolve()).then(() => saveState(this.filename, snapshot));
    return this.saving;
  }
  event(op, type, message) { this.state.events.push({ at: new Date().toISOString(), operationId: op?.id ?? null, type, message }); }
  operation(id) { const op = this.state.operations.find(item => item.id === id); ensure(op, 'Unknown operation'); return op; }
  async refresh() {
    if (this.busy) return;
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      for (const op of this.state.operations) {
        if (!op.planHash || op.interrupted || op.delivery?.status === 'response-lost') continue;
        try {
          const next = await this.adapter.observe(op);
          if (next.status !== op.observation?.status) this.event(op, next.status, `Observed ${next.status}; ${next.status === 'committed' ? 'payment and exact application effect confirmed' : 'authorization is not payment'}.`);
          op.observation = next;
        } catch { op.readUnavailable = true; continue; }
        delete op.readUnavailable;
      }
      await this.save();
    })();
    try { await this.refreshing; } finally { this.refreshing = null; }
  }
  async start(action, op, work) {
    ensure(!this.busy, 'Another explicit operation is in progress');
    this.busy = { action, operationId: op.id }; op.inFlight = action; delete op.error;
    if (this.refreshing) await this.refreshing;
    await this.save();
    this.task = (async () => {
      try { await work(); }
      catch (error) {
        // Do not send proof CLI output, witnesses or filesystem paths into the UI.
        op.error = { code: 'operation-needs-inspection', message: 'The operation did not complete. Reconcile any retained transaction before authorizing anything new.' };
        if (action === 'approve-query' && !op.tickets.query && String(error.message).includes('Query snapshot changed')) {
          op.queryDraftStale = true;
          op.error = { code: 'query-draft-stale', message: 'The prepared query snapshot changed. Prepare and explicitly approve a fresh request; this draft was not queued.' };
        }
        if (!op.queryDraftStale) op.interrupted = action;
        this.event(op, 'attention', op.error.message);
        await this.adapter.recordFailure?.(op, error);
      } finally { delete op.inFlight; await this.save(); this.busy = null; }
    })();
    return { accepted: true, operationId: op.id };
  }
  async prepare(input) {
    ensure(input && ['merchant', 'license'].includes(input.consumer), 'Choose a supported reference application');
    ensure(Number.isSafeInteger(input.amount) && input.amount > 0 && input.amount <= 100, 'Choose 1–100 synthetic units');
    ensure(typeof input.requestId === 'string' && /^[0-9a-f-]{36}$/.test(input.requestId), 'Preparation needs a unique request ID');
    const existing = this.state.operations.find(op => op.requestId === input.requestId);
    if (existing) { ensure(existing.consumer === input.consumer && existing.amount === input.amount, 'Request ID is already bound'); return { accepted: true, operationId: existing.id, existing: true }; }
    ensure(!this.busy, 'Another explicit operation is in progress');
    const op = { id: randomUUID(), requestId: input.requestId, label: `purchase-${this.state.operations.length + 1}`, consumer: input.consumer,
      amount: input.amount, tickets: {}, createdAt: new Date().toISOString() };
    this.state.operations.push(op);
    return this.start('prepare', op, async () => {
      const prepared = await this.adapter.prepare(op); Object.assign(op, prepared);
      this.event(op, 'prepared', 'Native proofs and exact application request prepared. No policy query or payment approved.');
    });
  }
  async act(id, action, input = {}) {
    const op = this.operation(id);
    ensure(['approve-query', 'review-payment', 'approve-commit', 'observe', 'recover', 'resubmit-query', 'resubmit-commit'].includes(action), 'Unsupported action');
    ensure(op.planHash, 'Preparation must complete before this action');
    if (action === 'observe') { await this.refresh(); return { observed: true }; }
    if (action === 'review-payment') {
      ensure(!this.busy, 'Another explicit operation is in progress'); await this.refresh();
      ensure(op.observation?.status === 'authorized', 'An active authorization is required');
      op.finalReview = true; await this.save(); return { reviewed: true };
    }
    if (action === 'approve-query') {
      ensure(input.approvalDigest === approvalDigest(op, 'query'), 'Query approval differs from the displayed request');
      ensure(!op.tickets.query && !op.interrupted && !op.queryDraftStale && (op.observation?.status ?? 'unobserved') === 'unobserved', 'Query already staged or requires explicit recovery');
    }
    if (action === 'approve-commit') {
      ensure(input.approvalDigest === approvalDigest(op, 'commit'), 'Payment approval differs from the displayed request');
      ensure(!op.tickets.commit && !op.interrupted, 'Final transaction already retained; use recovery');
      await this.refresh(); ensure(op.observation?.status === 'authorized', 'Authorization is stale, expired, denied or not yet ready');
      ensure(input.loseResponse === undefined || typeof input.loseResponse === 'boolean', 'Invalid test fault option');
    }
    return this.start(action, op, async () => {
      if (action.startsWith('approve-')) {
        const role = action === 'approve-query' ? 'query' : 'commit';
        const ticket = await this.adapter.stage(op, role);
        await writeNew(resolve(this.directory, `${op.id}-${role}-ticket.json`), JSON.stringify(ticket));
        op.tickets[role] = ticket; op.delivery = { status: 'prepared', signature: ticket.signature, role }; await this.save();
        if (role === 'commit' && input.loseResponse) {
          await this.adapter.loseResponse(op, ticket);
          op.delivery.status = 'response-lost';
          this.event(op, 'test-response-lost', 'TEST: send acknowledgement dropped. The retained signature may already have paid. Recover without signing again.');
        } else {
          const receipt = await this.adapter.submit(op, ticket);
          op.delivery = { status: 'landed', signature: ticket.signature, role, slot: receipt.slot };
          op.observation = await this.adapter.observe(op);
          this.event(op, role === 'query' ? 'query-approved' : 'payment-approved', role === 'query'
            ? 'Owner and policy administrator approved this exact query. Awaiting authenticated computation; no payment yet.'
            : 'Owner approved the exact native payment and application effect. Paid status requires the SDK committed observation.');
        }
      } else {
        const role = action === 'resubmit-query' ? 'query' : action === 'resubmit-commit' ? 'commit' : op.tickets.commit ? 'commit' : 'query';
        const ticket = op.tickets[role] ?? await this.adapter.discoverTicket(op, role);
        ensure(ticket, 'No retained transaction found; inspect preparation before any new authorization');
        op.tickets[role] = ticket; await this.save();
        const result = await this.adapter.recover(op, ticket, action.startsWith('resubmit-'));
        op.delivery = { status: result.delivery.status, signature: ticket.signature, role, attempts: result.delivery.attempts,
          canBroadcast: result.delivery.canBroadcast, slot: result.delivery.receipt?.slot };
        op.observation = result.observation; op.lastRecovery = { processId: result.processId, createsNewSignedTransaction: false };
        delete op.interrupted; delete op.error;
        this.event(op, 'recovered', `A separate keyless process observed ${result.observation.status}. No replacement signature or private query was created.`);
      }
    });
  }
  projection(view = 'owner') {
    ensure(['owner', 'public'].includes(view), 'Unknown view');
    const operations = this.state.operations.map(op => {
      const phase = op.inFlight === 'prepare' ? 'preparing' : phaseOf(op), actions = [];
      if (!this.busy && op.planHash && view === 'owner') {
        actions.push('observe');
        if (!op.tickets.query && !op.interrupted && !op.queryDraftStale && !terminal.has(op.observation?.status)) actions.push('approve-query');
        if (op.observation?.status === 'authorized' && !op.tickets.commit && !op.interrupted) actions.push('approve-commit');
        if (op.tickets.query || op.tickets.commit || op.interrupted) actions.push('recover');
        if (op.delivery?.canBroadcast) actions.push(`resubmit-${op.delivery.role}`);
      }
      const paid = op.observation?.status === 'committed';
      return { id: op.id, label: op.label, consumer: op.consumer, purpose: op.consumer === 'merchant' ? 'Developer asset pack · SKU 7' : 'Analytics application license',
        phase, sdkStatus: op.observation?.status ?? 'unobserved', owner: op.owner, source: op.source, destination: op.destination, effect: op.effect,
        terms: op.terms,
        ...(view === 'owner' ? { amount: op.amount, approvalDigest: approvalDigest(op, 'query'), commitApprovalDigest: approvalDigest(op, 'commit') } : {}),
        delivery: op.delivery, observation: op.observation && { status: op.observation.status, slot: op.observation.slot, licenseActive: op.observation.licenseActive, licenseExpirySlot: op.observation.licenseExpirySlot },
        paidEffect: paid ? { kind: op.consumer, label: op.consumer === 'merchant' ? 'SKU 7 entitlement issued' : 'Exact product license issued',
          licenseActive: op.observation.licenseActive, expirySlot: op.observation.licenseExpirySlot } : null,
        actions, error: op.error, readUnavailable: Boolean(op.readUnavailable), recovery: op.lastRecovery };
    });
    const paidAmounts = this.state.operations.filter(op => op.observation?.status === 'committed').reduce((sum, op) => sum + op.amount, 0);
    return { schema: 1, view, session: { id: this.state.id, genesis: this.state.genesis, profile: 'local-native-ct-v0', local: true,
      loadedPrograms: this.bootstrap.loadedPrograms.length, scope: 'Synthetic native token · two source owners · one quota / MXE', ...(view === 'owner' ? { initialAllowance: 100 } : {}) },
      busy: this.busy, operations, events: this.state.events.slice(-30),
      ...(view === 'owner' ? { observerDisclosures: { initialAllowance: 100, inferredRemaining: 100 - paidAmounts,
        note: 'TEST OBSERVER: allowance and remainder are inferred from known synthetic setup and paid purchases; the MXE quota was not decrypted. Requested amounts are known to the approving client.' } } : {}) };
  }
}
