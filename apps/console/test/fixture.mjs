import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { ConsoleService } from '../service.mjs';
import { REPO } from '../../../packages/local-client/src/runtime.mjs';

export async function setup(t, options = {}) {
  const directory = await mkdtemp(resolve(REPO, '.local/console-host-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [], observations = new Map(), plans = new Map();
  const adapter = { project: { name: 'Host-only test', release: 'a'.repeat(64), deploymentHash: 'b'.repeat(64), genesis: 'test-genesis',
    profile: 'local-custom-policy-v1', network: 'Local Solana', administratorConfigured: true, signingEnabled: true,
    sources: [{ id: 'a', label: 'Wallet A', canSign: true }, { id: 'b', label: 'Wallet B', canSign: true }] },
    refreshProject: async () => { calls.push('slot'); },
    prepare: async op => { calls.push('prepare'); plans.set(op.id, 'c'.repeat(64)); return { planHash: plans.get(op.id), observation: { status: 'unobserved' } }; },
    inspect: async op => ({ planHash: plans.get(op.id), observation: { status: observations.get(op.id) ?? 'unobserved' } }),
    observe: async op => { calls.push('observe'); return { status: observations.get(op.id) ?? 'unobserved' }; },
    approve: async (op, role) => { calls.push(`approve:${role}`); observations.set(op.id, role === 'query' ? 'authorized' : 'committed'); return { delivery: { status: 'landed', signature: `${role}-host-signature`, canBroadcast: false }, observation: { status: observations.get(op.id) } }; },
    recover: async (op, role, submit) => { calls.push(`recover:${role}:${submit}`); return { delivery: { status: 'delivery-unavailable', canBroadcast: false }, observation: { status: observations.get(op.id) ?? 'unresolved' } }; }, ...options };
  const service = await ConsoleService.open({ directory, adapter });
  const request = (changes = {}) => ({ requestId: randomUUID(), title: 'Purchase', sourceId: 'a', amount: '20', consumer: { kind: 'merchant', sku: '1' }, consent: 'prepare-native', ...changes });
  const prepared = async input => { input ??= request(); await service.prepare(input); await service.task; return service.state.operations.find(op => op.id === input.requestId); };
  const act = async (op, action) => { await service.act(op.id, action, { consent: action, planHash: op.planHash }); await service.task; };
  return { directory, adapter, calls, observations, plans, service, request, prepared, act };
}
