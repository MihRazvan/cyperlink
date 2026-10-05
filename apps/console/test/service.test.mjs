import test from 'node:test';
import assert from 'node:assert/strict';
import { ConsoleService } from '../service.mjs';
import { setup } from './fixture.mjs';
import { privateJson } from '../../../packages/local-client/src/private-store.mjs';
import { resolve } from 'node:path';
test('duplicate HTTP request returns the same preparation, altered intent or duplicate business charge fails', async t => {
  const f = await setup(t), input = f.request(); await f.prepared(input);
  await f.service.prepare(input); assert.equal(f.calls.filter(x => x === 'prepare').length, 1);
  await assert.rejects(f.service.prepare({ ...input, amount: '21' }), /different purchase/);
  await assert.rejects(f.service.prepare(f.request()), /already has a retained operation/);
});
test('separate approval, stale recheck, and GET observation never silently sign', async t => {
  const f = await setup(t), op = await f.prepared(); await f.service.refresh(); assert(!f.calls.some(x => x.startsWith('approve')));
  await assert.rejects(f.service.act(op.id, 'approve-query', { consent: 'approve-payment', planHash: op.planHash }), /Explicit/);
  await assert.rejects(f.service.act(op.id, 'approve-query', { consent: 'approve-query', planHash: '0'.repeat(64) }), /displayed purchase changed/);
  await f.act(op, 'approve-query'); assert.equal(op.observation.status, 'authorized');
  f.observations.set(op.id, 'stale'); await f.act(op, 'approve-payment');
  assert.equal(op.error.code, 'AUTHORIZATION_CHANGED'); assert(!f.calls.includes('approve:commit'));
  assert.equal(op.approvals.commit, undefined);
});
test('paid effect survives account outage as history without enabling another purchase', async t => {
  const f = await setup(t), op = await f.prepared(); await f.act(op, 'approve-query'); await f.act(op, 'approve-payment');
  f.adapter.observe = async () => { throw Error('secret/path/keys not public'); };
  await f.service.refresh(); const visible = f.service.projection().operations[0];
  assert.equal(visible.paymentCommitted, true); assert.equal(visible.observation, null);
  assert(!JSON.stringify(visible).includes('secret/path')); assert(!visible.actions.includes('approve-payment'));
  await assert.rejects(f.service.prepare(f.request()), /already has a retained operation/);
});
test('fresh keyless session retains role intent after stage failure and recovers without restaging', async t => {
  const f = await setup(t), op = await f.prepared();
  f.adapter.approve = async () => { throw Error('Injected interruption after durable SDK stage'); };
  await f.act(op, 'approve-query'); assert.equal(op.approvals.query, true);
  f.adapter.project.administratorConfigured = false; f.adapter.project.signingEnabled = false;
  for (const source of f.adapter.project.sources) source.canSign = false;
  const reopened = await ConsoleService.open({ directory: f.directory, adapter: f.adapter });
  const actions = reopened.projection().operations[0].actions; assert(actions.includes('recover-query')); assert(!actions.includes('approve-query'));
  await reopened.act(op.id, 'recover-query', { consent: 'recover-query', planHash: op.planHash }); await reopened.task;
  assert(f.calls.includes('recover:query:false')); assert.equal(reopened.state.operations[0].deliveries.query.status, 'delivery-unavailable');
  assert(!reopened.projection().operations[0].actions.includes('submit-query'));
});
test('a workspace is bound to the deployment, not just the shared policy release', async t => {
  const f = await setup(t); f.adapter.project.deploymentHash = 'd'.repeat(64);
  await assert.rejects(ConsoleService.open({ directory: f.directory, adapter: f.adapter }), /different deployment/);
});
test('concurrent clicks cannot create a second operation or begin another approval', async t => {
  const f = await setup(t); let finish; f.adapter.prepare = async () => new Promise(resolve => { finish = resolve; });
  await f.service.prepare(f.request());
  await assert.rejects(f.service.prepare(f.request({ consumer: { kind: 'merchant', sku: '2' } })), /current project action/);
  finish({ planHash: 'c'.repeat(64), observation: { status: 'unobserved' } }); await f.service.task;
  assert.equal(f.service.state.operations.length, 1);
});

test('explicit fresh purchase preserves unpaid history and never observes or pays its superseded predecessor', async t => {
  const f = await setup(t);
  const old = await f.prepared(f.request({ sourceId: 'b', consumer: { kind: 'license', productHex32: 'a'.repeat(64), expirySlot: '100' } }));
  await f.act(old, 'approve-query');
  f.adapter.observe = async op => ({ status: op.id === old.id ? 'stale' : f.observations.get(op.id) ?? 'unobserved', slot: 42 });
  await f.service.refresh();
  const originalPrepare = f.adapter.prepare;
  f.adapter.prepare = async op => {
    const retained = await privateJson(resolve(f.directory, 'console.json'));
    assert.equal(retained.operations[0].supersededBy, op.id, 'supersession must be durable before fresh native preparation');
    return originalPrepare(op);
  };
  const fresh = await f.prepared(f.request({ sourceId: 'b', consumer: { ...old.consumer, expirySlot: '200' } }));
  const observed = [];
  f.adapter.observe = async op => {
    observed.push(op.id);
    if (op.id === old.id) throw Error('Old permit conflicts with the newly issued shared effect');
    return { status: f.observations.get(op.id) ?? 'unobserved' };
  };
  await f.act(fresh, 'approve-query'); await f.act(fresh, 'approve-payment');
  await f.service.refresh();
  const visible = f.service.projection().operations[0];
  assert.equal(visible.phase, 'superseded'); assert.equal(visible.supersededBy, fresh.id);
  assert.deepEqual(visible.historicalObservation, { status: 'stale', slot: 42 });
  assert.equal(visible.observation, null); assert.equal(visible.paymentCommitted, false); assert.deepEqual(visible.actions, []);
  assert.equal(fresh.paymentCommitted, true); assert(!observed.includes(old.id));
  for (const action of ['refresh', 'approve-query', 'approve-payment', 'recover-query', 'recover-payment', 'submit-query', 'submit-payment']) {
    await assert.rejects(f.service.act(old.id, action, { consent: action, planHash: old.planHash }), /unavailable/);
  }
  const reopened = await ConsoleService.open({ directory: f.directory, adapter: f.adapter });
  await reopened.refresh(); assert(!observed.includes(old.id));
  assert.equal(reopened.projection().operations[0].paymentCommitted, false);
  await assert.rejects(reopened.prepare(f.request({ sourceId: 'b', consumer: { ...old.consumer, expirySlot: '300' } })), /already has a retained operation/);
});

test('explicit supersession chains preserve each historical snapshot and unknown successors block more preparation', async t => {
  const f = await setup(t), first = await f.prepared();
  f.observations.set(first.id, 'stale'); await f.service.refresh();
  const second = await f.prepared();
  await assert.rejects(f.service.prepare(f.request()), /already has a retained operation/);
  f.observations.set(second.id, 'expired'); await f.service.refresh();
  f.adapter.prepare = async () => { throw Error('Interrupted fresh native preparation'); };
  const third = await f.prepared();
  assert.equal(first.supersededBy, second.id); assert.equal(first.historicalObservation.status, 'stale');
  assert.equal(second.supersededBy, third.id); assert.equal(second.historicalObservation.status, 'expired');
  assert.equal(third.observation, null); assert.equal(third.phase, 'unresolved');
  await assert.rejects(f.service.prepare(f.request()), /already has a retained operation/);
  const reopened = await ConsoleService.open({ directory: f.directory, adapter: f.adapter });
  assert.deepEqual(reopened.projection().operations.slice(0, 2).map(op => op.actions), [[], []]);
});

test('legacy unknown history alongside a newer paid effect never gains inferred supersession or success', async t => {
  const f = await setup(t), old = await f.prepared();
  f.observations.set(old.id, 'stale'); await f.service.refresh();
  const fresh = await f.prepared(); await f.act(fresh, 'approve-query'); await f.act(fresh, 'approve-payment');
  // Model a preserved pre-fix workspace: it has no saved supersession relationship.
  delete old.supersededBy; delete old.historicalObservation; old.observation = null; old.phase = 'unresolved';
  await f.service.save();
  f.adapter.observe = async op => { if (op.id === old.id) throw Error('Conflicting effect'); return { status: 'committed' }; };
  const reopened = await ConsoleService.open({ directory: f.directory, adapter: f.adapter });
  await reopened.refresh();
  const history = reopened.projection().operations[0];
  assert.equal(history.supersededBy, undefined); assert.equal(history.historicalObservation, undefined);
  assert.equal(history.paymentCommitted, false); assert.equal(history.observation, null); assert(history.error);
  await assert.rejects(reopened.prepare(f.request()), /already has a retained operation/);
});

test('invalid saved supersession cannot bypass paid or unresolved purchase protection', async t => {
  const f = await setup(t), old = await f.prepared();
  f.observations.set(old.id, 'stale'); await f.service.refresh();
  const fresh = await f.prepared();
  old.historicalObservation = { status: 'unresolved' }; await f.service.save();
  await assert.rejects(ConsoleService.open({ directory: f.directory, adapter: f.adapter }), /Invalid retained purchase supersession/);
  old.historicalObservation = { status: 'stale' }; old.paymentCommitted = true; await f.service.save();
  await assert.rejects(ConsoleService.open({ directory: f.directory, adapter: f.adapter }), /Invalid retained purchase supersession/);
  old.paymentCommitted = false; old.supersededBy = old.id; await f.service.save();
  await assert.rejects(ConsoleService.open({ directory: f.directory, adapter: f.adapter }), /Invalid retained purchase supersession/);
  assert.notEqual(fresh.id, old.id);
});
