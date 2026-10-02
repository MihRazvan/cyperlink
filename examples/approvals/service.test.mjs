import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ApprovalsService, approvalDigest, phaseOf } from './service.mjs';
import { REPO } from '../../packages/local-client/src/runtime.mjs';
import { saveState } from './store.mjs';

async function fixture(t) {
  const directory = await mkdtemp(resolve(REPO, '.local/approvals-host-test-')); await chmod(directory, 0o700);
  t.after(() => rm(directory, { force: true, recursive: true }));
  const calls = [], observations = new Map();
  const adapter = {
    validateRetained: async () => {}, recordFailure: async () => {},
    prepare: async op => { calls.push('prepare'); observations.set(op.id, { status: 'unobserved', slot: 10, job: 'retained-expected-job-address', permit: 'retained-expected-permit-address' }); return { planHash: op.id, owner: 'owner', source: 'source', destination: 'destination', effect: 'effect', observation: observations.get(op.id) }; },
    observe: async op => { calls.push('observe'); return observations.get(op.id); },
    stage: async (op, role) => { calls.push(`stage-${role}`); return { signature: `${op.id}-${role}`, role }; },
    submit: async (op, ticket) => { calls.push(`submit-${ticket.role}`); observations.set(op.id, { status: ticket.role === 'query' ? 'queued' : 'committed', slot: 12 }); return { slot: 12 }; },
    loseResponse: async op => { calls.push('lose-response'); observations.set(op.id, { status: 'committed', slot: 14 }); },
    discoverTicket: async () => null,
    recover: async (op, ticket, submit) => { calls.push(submit ? 'resubmit-existing' : 'recover'); return { processId: 123, delivery: { status: 'landed', attempts: 1, canBroadcast: false, receipt: { slot: 14 } }, observation: observations.get(op.id) }; },
  };
  const bootstrap = { genesisHash: 'host-test-genesis', bootstrapDirectory: directory, loadedPrograms: new Array(10) };
  const service = await ApprovalsService.open({ directory, bootstrap, adapter });
  return { service, adapter, bootstrap, directory, calls, observations };
}
async function prepare(f, consumer = 'merchant', amount = 40, requestId = randomUUID()) {
  const result = await f.service.prepare({ consumer, amount, requestId }); await f.service.task;
  return f.service.operation(result.operationId);
}
async function approve(f, op, role, rest = {}) {
  await f.service.act(op.id, role === 'query' ? 'approve-query' : 'approve-commit', { approvalDigest: approvalDigest(op, role), ...rest });
  await f.service.task;
}

test('host adapter: opening, preparing and reading never sign query or payment', async t => {
  const f = await fixture(t), op = await prepare(f); await f.service.refresh();
  assert.equal(phaseOf(op), 'awaiting-query-approval'); assert(!f.calls.some(value => value.startsWith('stage')));
  await assert.rejects(f.service.act(op.id, 'approve-query', { approvalDigest: 'another-request' }), /differs/);
  await approve(f, op, 'query'); assert.equal(phaseOf(op), 'private-computation');
  await assert.rejects(f.service.act(op.id, 'approve-query', { approvalDigest: approvalDigest(op, 'query') }), /already/);
  assert.equal(f.calls.filter(value => value === 'stage-query').length, 1);
  await assert.rejects(f.service.act(op.id, 'approve-commit', { approvalDigest: approvalDigest(op, 'commit') }), /not yet ready/);
});

test('host adapter: callback is not paid; exact final approval and consumer-aware observation are required', async t => {
  const f = await fixture(t), op = await prepare(f); await approve(f, op, 'query');
  f.observations.set(op.id, { status: 'authorized', slot: 13 }); await f.service.refresh();
  assert.equal(f.service.projection().operations[0].paidEffect, null);
  await f.service.act(op.id, 'review-payment'); assert.equal(phaseOf(op), 'awaiting-final-approval');
  await approve(f, op, 'commit'); assert.equal(f.service.projection().operations[0].paidEffect.label, 'SKU 7 entitlement issued');
  await assert.rejects(f.service.act(op.id, 'approve-commit', { approvalDigest: approvalDigest(op, 'commit') }), /already retained/);
});

test('host adapter: lost response survives process-state reopening and recovery never signs again', async t => {
  const f = await fixture(t), op = await prepare(f); await approve(f, op, 'query');
  f.observations.set(op.id, { status: 'authorized', slot: 13 }); await f.service.refresh();
  await approve(f, op, 'commit', { loseResponse: true }); assert.equal(phaseOf(op), 'unresolved-delivery');
  f.service = await ApprovalsService.open(f); const reopened = f.service.operation(op.id);
  assert.equal(phaseOf(reopened), 'unresolved-delivery');
  await f.service.act(op.id, 'recover'); await f.service.task;
  assert.equal(phaseOf(reopened), 'committed'); assert.equal(f.calls.filter(value => value === 'stage-commit').length, 1);
  assert.equal(reopened.tickets.commit.signature, op.tickets.commit.signature);
  assert.equal(reopened.lastRecovery.createsNewSignedTransaction, false);
});

test('host adapter: preparation request IDs deduplicate; stale approval cannot trigger final signing or fresh query', async t => {
  const f = await fixture(t), requestId = randomUUID(), op = await prepare(f, 'license', 60, requestId);
  assert.equal((await f.service.prepare({ consumer: 'license', amount: 60, requestId })).operationId, op.id);
  await assert.rejects(f.service.prepare({ consumer: 'license', amount: 40, requestId }), /already bound/);
  await approve(f, op, 'query'); f.observations.set(op.id, { status: 'stale', slot: 15 }); await f.service.refresh();
  await assert.rejects(f.service.act(op.id, 'approve-commit', { approvalDigest: approvalDigest(op, 'commit') }), /stale/);
  assert.equal(phaseOf(op), 'stale'); assert(!f.calls.includes('stage-commit')); assert.equal(f.calls.filter(value => value === 'stage-query').length, 1);
});

test('public projection excludes requested amounts, inferred balance, private adapter data and approval digests', async t => {
  const f = await fixture(t), op = await prepare(f); op.privateWitness = 'PRIVATE-SENTINEL'; op.observation.privateKey = 'PRIVATE-SENTINEL';
  const view = f.service.projection('public'), encoded = JSON.stringify(view);
  for (const fragment of ['PRIVATE-SENTINEL', 'initialAllowance', 'inferredRemaining', 'approvalDigest', '"amount"']) assert(!encoded.includes(fragment));
  assert.equal(view.operations[0].owner, 'owner'); assert.deepEqual(view.operations[0].actions, []);
});

test('SDK terminal statuses remain distinct; interrupted preparation never resumes automatically', async t => {
  const f = await fixture(t), op = await prepare(f);
  for (const status of ['denied', 'stale', 'cancelled', 'expired', 'committed']) assert.equal(phaseOf({ ...op, observation: { status } }), status);
  op.inFlight = 'approve-query'; await saveState(f.service.filename, f.service.state);
  const reopened = await ApprovalsService.open(f); assert.equal(phaseOf(reopened.operation(op.id)), 'unresolved-delivery');
  assert(!f.calls.some(value => value.startsWith('stage')));
});

test('completed plan can be reattached after preparation response loss without regenerating proofs', async t => {
  const f = await fixture(t), op = await prepare(f), complete = { planHash: op.planHash, observation: op.observation };
  delete op.planHash; op.inFlight = 'prepare'; await f.service.save();
  f.adapter.loadCompletedPreparation = async () => complete;
  const reopened = await ApprovalsService.open(f);
  assert.equal(phaseOf(reopened.operation(op.id)), 'awaiting-query-approval');
  assert.equal(f.calls.filter(value => value === 'prepare').length, 1);
});

test('pre-query counter drift is displayed as stale draft and never silently refreshed', async t => {
  const f = await fixture(t), op = await prepare(f);
  f.adapter.stage = async () => { throw Error('Query snapshot changed; explicit fresh preparation required'); };
  await approve(f, op, 'query'); assert.equal(phaseOf(op), 'stale');
  assert.equal(op.observation.status, 'unobserved'); assert(!op.tickets.query);
  assert(!f.service.projection().operations[0].actions.includes('approve-query'));
});

test('journaled signing failure requires ticket discovery before any second query signature', async t => {
  const f = await fixture(t), op = await prepare(f); let stages = 0;
  f.adapter.stage = async () => { stages++; throw Error('Simulation RPC response lost after journal write'); };
  await approve(f, op, 'query'); assert.equal(phaseOf(op), 'unresolved-delivery');
  await assert.rejects(f.service.act(op.id, 'approve-query', { approvalDigest: approvalDigest(op, 'query') }), /recovery/);
  assert.equal(stages, 1);
  f.adapter.discoverTicket = async () => ({ role: 'query', signature: 'original-journaled-wire' });
  await f.service.act(op.id, 'recover'); await f.service.task;
  assert.equal(op.tickets.query.signature, 'original-journaled-wire'); assert.equal(stages, 1);
});

test('concurrent prepare during an in-flight read reserves one task and creates no rejected orphan', async t => {
  const f = await fixture(t); let release;
  f.service.refreshing = new Promise(done => { release = done; });
  const first = f.service.prepare({ consumer: 'merchant', amount: 40, requestId: randomUUID() });
  await assert.rejects(f.service.prepare({ consumer: 'license', amount: 40, requestId: randomUUID() }), /in progress/);
  assert.equal(f.service.state.operations.length, 1); release(); await first; await f.service.task;
  f.service.refreshing = null;
  assert.equal(f.calls.filter(value => value === 'prepare').length, 1);
});

test('journaled commit staging failure recovers commit rather than older query and never signs twice', async t => {
  const f = await fixture(t), op = await prepare(f); await approve(f, op, 'query');
  const querySignature = op.tickets.query.signature;
  f.observations.set(op.id, { status: 'authorized', slot: 13 }); await f.service.refresh();
  let stages = 0;
  f.adapter.stage = async (_op, role) => { assert.equal(role, 'commit'); stages++; throw Error('Commit journal persisted; simulation response lost'); };
  await approve(f, op, 'commit'); assert.equal(op.interrupted, 'approve-commit'); assert.equal(op.tickets.commit, undefined);
  assert.equal(op.recoveryRole, 'commit');
  op.delivery.canBroadcast = true; // Older query delivery advice must not override the interrupted payment.
  assert(!f.service.projection().operations[0].actions.includes('resubmit-query'));
  // A failed first discovery and process reopen must not erase which stage was interrupted.
  f.adapter.discoverTicket = async (_op, role) => { assert.equal(role, 'commit'); return null; };
  await f.service.act(op.id, 'recover'); await f.service.task;
  assert.equal(op.interrupted, 'recover'); assert.equal(op.recoveryRole, 'commit');
  await assert.rejects(f.service.act(op.id, 'resubmit-query'), /most recent retained/);
  f.service = await ApprovalsService.open(f); const reopened = f.service.operation(op.id);
  const commitTicket = { role: 'commit', signature: 'original-journaled-commit-wire' };
  f.adapter.discoverTicket = async (_op, role) => { assert.equal(role, 'commit'); return commitTicket; };
  let recoveries = 0;
  f.adapter.recover = async (recovering, ticket, submit) => {
    assert.deepEqual(ticket, commitTicket); assert.equal(submit, false); recoveries++;
    assert.equal(recovering.delivery.role, 'commit'); assert.equal(recovering.delivery.signature, commitTicket.signature);
    assert.equal(recovering.delivery.status, 'unresolved-delivery');
    return { processId: 123, delivery: { status: 'simulation-required', canBroadcast: false, attempts: 0 }, observation: { status: 'authorized', slot: 14 } };
  };
  await f.service.act(op.id, 'recover'); await f.service.task;
  assert.equal(recoveries, 1); assert.equal(stages, 1);
  assert.equal(reopened.tickets.query.signature, querySignature); assert.deepEqual(reopened.tickets.commit, commitTicket);
  assert.equal(reopened.delivery.role, 'commit'); assert.equal(reopened.delivery.status, 'simulation-required');
  await assert.rejects(f.service.act(op.id, 'approve-commit', { approvalDigest: approvalDigest(reopened, 'commit') }), /already retained/);
  assert.equal(stages, 1);
});

test('legacy interrupted commit infers its role and wrong-role discovered ticket fails closed', async t => {
  const f = await fixture(t), op = await prepare(f); await approve(f, op, 'query');
  f.observations.set(op.id, { status: 'authorized', slot: 13 }); await f.service.refresh();
  op.interrupted = 'approve-commit'; delete op.recoveryRole; await f.service.save();
  const queryTicket = op.tickets.query;
  f.adapter.discoverTicket = async (_op, role) => { assert.equal(role, 'commit'); return queryTicket; };
  let recovered = false; f.adapter.recover = async () => { recovered = true; };
  await f.service.act(op.id, 'recover'); await f.service.task;
  assert.equal(recovered, false); assert.equal(op.tickets.commit, undefined);
  assert.equal(op.recoveryRole, 'commit'); assert.equal(op.interrupted, 'recover');
  assert(!f.service.projection().operations[0].actions.includes('approve-commit'));
});

test('custom policy UI exposes release and actual decision without inventing private state or denial reason', async t => {
  const f=await fixture(t);
  const directory=await mkdtemp(resolve(REPO,'.local/approvals-custom-host-test-'));await chmod(directory,0o700);
  t.after(()=>rm(directory,{force:true,recursive:true}));
  const bootstrap={...f.bootstrap,bootstrapDirectory:directory,descriptor:{profile:'local-custom-policy-v1'},loadedPrograms:new Array(9),
    policy:{name:'minimum-reserve',release:'release-hash',schema:'schema-hash',state:'state-account',auth:'auth-program',domain:'domain-hash',mxe:'mxe-account'},
    initialAllowance:999999,initialPrivateFields:'PRIVATE-SENTINEL',observerDisclosures:{inferredRemaining:999999}};
  f.service=await ApprovalsService.open({directory,bootstrap,adapter:f.adapter});
  const op=await prepare(f);f.observations.set(op.id,{status:'authorized',slot:12});await f.service.refresh();
  assert.equal(f.service.projection().operations[0].policyDecision,'allowed');
  f.observations.set(op.id,{status:'denied',slot:13});await f.service.refresh();
  for(const view of ['owner','public']){
    const projection=f.service.projection(view),encoded=JSON.stringify(projection);
    assert.equal(projection.session.profile,'local-custom-policy-v1');assert.equal(projection.session.policy.name,'minimum-reserve');
    assert.equal(projection.session.policy.mxe,'mxe-account');assert.equal(projection.operations[0].policyDecision,'denied');
    assert.equal(projection.operations[0].paidEffect,null);
    for(const fragment of ['initialAllowance','inferredRemaining','PRIVATE-SENTINEL','999999','reserve exhausted'])assert(!encoded.includes(fragment));
  }
  await assert.rejects(ApprovalsService.open({directory,bootstrap:{...bootstrap,policy:{...bootstrap.policy,release:'other-release'}},adapter:f.adapter}),/different policy release/);
});
