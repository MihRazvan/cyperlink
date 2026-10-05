import test from 'node:test';
import assert from 'node:assert/strict';
import { ConsoleService } from '../service.mjs';
import { setup } from './fixture.mjs';
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
