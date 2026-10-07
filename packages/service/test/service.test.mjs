import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ProjectService, startService } from '../src/index.mjs';
import { REPO } from '../../local-client/src/runtime.mjs';
import { canonicalHash } from '../../policy-client/src/deployment.mjs';
import { saveState } from '../../local-client/src/private-store.mjs';

const token = 'host-test-only-not-a-deployment-secret'.repeat(2);
async function fixture(t, http = false) {
  const directory = resolve(REPO, '.local', `service-host-test-${randomUUID()}`);
  await mkdir(directory, { mode: 0o700 });
  const sources = { reference: { instancePath: '/configured/instance.json', workspaceDirectory: '/configured/workspace' } };
  const calls = [];
  let response = { observation: { status: 'committed', slot: 100, commitment: 'confirmed', licenseActive: false } };
  const backend = {
    project: { name: 'Host-only policy', release: 'a'.repeat(64), profile: 'local-custom-policy-v1', genesis: 'test-genesis', deploymentHash: 'b'.repeat(64), network: 'local' },
    inspect: async reference => { calls.push(['inspect', reference]); return { planHash: (reference === 'second' ? 'd' : 'c').repeat(64), consumerKind: 'license', contextSlot: 10 }; },
    observe: async (...args) => { calls.push(['observe', ...args]); if (response instanceof Error) throw response; return response; },
    recover: async (...args) => { calls.push(['recover', ...args]); if (response instanceof Error) throw response; return { ...response,
      delivery: { status: 'observed-without-receipt', role: args[3], signature: 'retained-signature', wireSha256: 'e'.repeat(64), attempts: 1, canBroadcast: false, observationSlot: 100 },
      ticket: { journalDirectory: '/private/journal', wire: 'secret' } }; },
  };
  const options = { directory, sources, connect: async source => { assert.deepEqual(source, sources.reference); calls.push(['connect']); return backend; } };
  let instance = http ? await startService({ ...options, port: 0, token }) : { service: await ProjectService.open(options) };
  const close = async () => instance.close ? instance.close() : instance.service.close();
  t.after(async () => { await close(); await rm(directory, { recursive: true, force: true }); });
  const request = async (path, input, headers = {}) => {
    const response = await fetch(instance.url + path, { method: input === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, ...(input === undefined ? {} : { 'content-type': 'application/json' }), ...headers }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
    return { status: response.status, body: await response.json() };
  };
  return { directory, options, backend, calls, request, set response(value) { response = value; }, get service() { return instance.service; },
    async restart() { await close(); instance = http ? await startService({ ...options, port: 0, token }) : { service: await ProjectService.open(options) }; },
    async imported() { await instance.service.register({ id: 'project', source: 'reference' }); return instance.service.importOperation('project', { id: 'purchase', reference: 'original' }); } };
}

test('registration and import are durable, idempotent and reject identity reuse', async t => {
  const f = await fixture(t); const original = await f.imported();
  assert.deepEqual(await f.service.importOperation('project', { id: 'purchase', reference: 'original' }), original);
  await assert.rejects(f.service.importOperation('project', { id: 'purchase', reference: 'second' }), { code: 'IDENTITY_CONFLICT' });
  await assert.rejects(f.service.importOperation('project', { id: 'duplicate', reference: 'original' }), { code: 'OPERATION_EXISTS' });
  await f.restart();
  assert.deepEqual(f.service.getOperation('project', 'purchase'), original);
  assert.equal(f.service.listProjects().length, 1);
});

test('concurrent imports serialize around one retained identity', async t => {
  const f = await fixture(t); await f.service.register({ id: 'project', source: 'reference' });
  const results = await Promise.all(Array.from({ length: 12 }, () => f.service.importOperation('project', { id: 'purchase', reference: 'original' })));
  assert(results.every(value => value.planHash === results[0].planHash));
  assert.equal(f.service.listOperations('project').length, 1);
});

test('SDK observation floor and historical paid fact survive restart and outages', async t => {
  const f = await fixture(t); await f.imported();
  await f.service.observe('project', 'purchase');
  await f.restart(); f.response = new Error('/private/secrets/exception');
  await assert.rejects(f.service.observe('project', 'purchase'), { code: 'OBSERVATION_UNAVAILABLE' });
  const retained = f.service.getOperation('project', 'purchase');
  assert.equal(retained.paymentCommitted, true); assert.equal(retained.observation, null); assert.equal(retained.minimumSlot, 100);
  assert.equal(f.calls.filter(call => call[0] === 'observe').at(-1)[3], 100);
  assert(!JSON.stringify(retained).includes('/private/'));
  await f.restart(); assert.equal(f.service.getOperation('project', 'purchase').paymentCommitted, true);
});

test('regressed observation cannot replace history or reduce persisted context', async t => {
  const f = await fixture(t); await f.imported(); await f.service.observe('project', 'purchase');
  f.response = { observation: { status: 'authorized', slot: 50 } };
  await assert.rejects(f.service.observe('project', 'purchase'), { code: 'OBSERVATION_UNAVAILABLE' });
  assert.equal(f.service.getOperation('project', 'purchase').minimumSlot, 100);
  assert.equal(f.service.getOperation('project', 'purchase').paymentCommitted, true);
});

test('metadata GET does not invoke RPC and recovery exposes no ticket or paths', async t => {
  const f = await fixture(t); await f.imported(); const count = f.calls.length;
  f.service.getOperation('project', 'purchase'); f.service.listProjects(); f.service.listOperations('project');
  assert.equal(f.calls.length, count);
  const result = await f.service.recover('project', 'purchase', { role: 'commit' });
  assert.equal(result.deliveries.commit.signature, 'retained-signature');
  assert(!JSON.stringify(result).includes('journal')); assert(!JSON.stringify(result).includes('secret'));
  assert.equal(f.calls.at(-1)[0], 'recover'); assert.equal(f.calls.at(-1).at(-1), 'commit');
});

test('returned metadata cannot mutate the in-process persisted state', async t => {
  const f = await fixture(t); await f.imported(); await f.service.observe('project', 'purchase');
  const result = f.service.getOperation('project', 'purchase'); result.observation.status = 'authorized';
  assert.equal(f.service.getOperation('project', 'purchase').observation.status, 'committed');
});

test('a changed configured deployment fails on reconnect without losing known payment', async t => {
  const f = await fixture(t); await f.imported(); await f.service.observe('project', 'purchase'); await f.restart();
  f.backend.project.deploymentHash = 'f'.repeat(64);
  await assert.rejects(f.service.observe('project', 'purchase'), { code: 'OBSERVATION_UNAVAILABLE' });
  assert.equal(f.service.getOperation('project', 'purchase').paymentCommitted, true);
});

test('service directory admits only one process and releases its own lock', async t => {
  const f = await fixture(t);
  await assert.rejects(ProjectService.open(f.options), /locked/);
  await f.restart(); assert.deepEqual(f.service.listProjects(), []);
});

test('API authenticates, imports, observes and recovers across restart', async t => {
  const f = await fixture(t, true);
  assert.equal((await f.request('/v1/projects', undefined, { authorization: '' })).status, 401);
  assert.equal((await f.request('/v1/projects', { id: 'project', source: 'reference' })).status, 200);
  const imported = await f.request('/v1/projects/project/operations', { id: 'purchase', reference: 'original' });
  assert.equal(imported.status, 200); assert.equal(imported.body.apiVersion, 'v1');
  await f.request('/v1/projects/project/operations/purchase/observe', {}); await f.restart();
  const recovered = await f.request('/v1/projects/project/operations/purchase/recover', { role: 'commit' });
  assert.equal(recovered.status, 200); assert.equal(recovered.body.data.paymentCommitted, true);
  assert.equal(recovered.body.data.observation.licenseActive, false);
  assert.equal((await f.request('/v1/projects/project/operations')).body.data.length, 1);
});

test('API rejects browser origin, paths, query options and all signing actions', async t => {
  const f = await fixture(t, true); await f.imported();
  assert.equal((await f.request('/v1/projects', undefined, { origin: 'https://example.test' })).status, 403);
  assert.equal((await f.request('/v1/projects?instancePath=/private')).status, 400);
  assert.equal((await f.request('/v1/projects', { id: 'bad', source: 'reference', instancePath: '/private' })).status, 422);
  assert.equal((await f.request('/v1/projects/project/operations', { id: 'bad', reference: '../private' })).status, 422);
  for (const action of ['prepare', 'stage', 'submit', 'approve-query', 'approve-payment']) {
    assert.equal((await f.request(`/v1/projects/project/operations/purchase/${action}`, {})).status, 404);
  }
  assert(!f.calls.some(call => ['observe', 'recover'].includes(call[0])));
});

test('structured API errors never echo backend diagnostics', async t => {
  const f = await fixture(t, true); await f.imported(); f.response = Error('secret private path');
  const result = await f.request('/v1/projects/project/operations/purchase/observe', {});
  assert.equal(result.status, 503); assert.equal(result.body.error.code, 'OBSERVATION_UNAVAILABLE');
  assert.match(result.body.error.requestId, /^[a-f0-9-]{36}$/);
  assert(!JSON.stringify(result).includes('secret private'));
});

test('API rejects oversized bodies with a bounded structured response', async t => {
  const f = await fixture(t, true);
  const result = await f.request('/v1/projects', { id: 'project', source: 'x'.repeat(9000) });
  assert.equal(result.status, 413); assert.equal(result.body.error.code, 'BODY_TOO_LARGE');
  assert.deepEqual(f.service.listProjects(), []);
});

test('local service configuration cannot inject signers or unrecognized options', async t => {
  const f = await fixture(t);
  await assert.rejects(ProjectService.open({ ...f.options, sources: { reference: { ...f.options.sources.reference, ownerKeyfile: '/secret' } } }), { code: 'INVALID_INPUT' });
  const source = await readFile(new URL('../src/backend.mjs', import.meta.url), 'utf8');
  assert(!/session\.(stageQuery|stageCommit|submit|prepare|signers)\(/.test(source));
  assert.match(source, /session\.recover\(plan, role\)/);
});

test('adding operation aliases preserves the project and existing operation across restart', async t => {
  const f = await fixture(t);
  f.options.sources.reference.operationSources = { original: { directory: '/configured/original', approvalsDirectory: '/configured/original-approvals' } };
  await f.restart(); const imported = await f.imported(); await f.service.observe('project', 'purchase');
  const project = f.service.getProject('project');
  f.options.sources.reference.operationSources.second = { directory: '/configured/second', approvalsDirectory: '/configured/second-approvals' };
  await f.restart();
  assert.deepEqual(await f.service.register({ id: 'project', source: 'reference' }), project);
  assert.equal((await f.service.importOperation('project', { id: 'purchase', reference: 'original' })).planHash, imported.planHash);
  assert.equal((await f.service.importOperation('project', { id: 'new-purchase', reference: 'second' })).planHash, 'd'.repeat(64));
  assert.equal((await f.service.recover('project', 'purchase', { role: 'commit' })).paymentCommitted, true);
  await f.restart(); assert.equal(f.service.listOperations('project').length, 2);
});

test('remapping a used alias to another plan or approval journal fails before SDK access', async t => {
  const f = await fixture(t);
  const original = { directory: '/configured/original', approvalsDirectory: '/configured/original-approvals' };
  f.options.sources.reference.operationSources = { original: { ...original } };
  await f.restart(); await f.imported(); await f.service.observe('project', 'purchase');
  for (const field of ['directory', 'approvalsDirectory']) {
    f.options.sources.reference.operationSources.original = { ...original, [field]: '/remapped' };
    await f.restart(); const count = f.calls.length;
    await assert.rejects(f.service.recover('project', 'purchase', { role: 'commit' }), { code: 'OBSERVATION_UNAVAILABLE' });
    await assert.rejects(f.service.importOperation('project', { id: 'purchase', reference: 'original' }), { code: 'IDENTITY_CONFLICT' });
    await assert.rejects(f.service.importOperation('project', { id: 'other-id', reference: 'original' }), { code: 'IDENTITY_CONFLICT' });
    assert.equal(f.calls.length, count); assert.equal(f.service.getOperation('project', 'purchase').paymentCommitted, true);
  }
  f.options.sources.reference.operationSources.original = original;
  await f.restart(); assert.equal((await f.service.observe('project', 'purchase')).paymentCommitted, true);
});

test('removing a used alias preserves metadata but blocks live recovery', async t => {
  const f = await fixture(t);
  f.options.sources.reference.operationSources = { original: { directory: '/configured/original', approvalsDirectory: '/configured/original-approvals' } };
  await f.restart(); await f.imported();
  delete f.options.sources.reference.operationSources.original;
  await f.restart(); const count = f.calls.length;
  assert.equal(f.service.getOperation('project', 'purchase').planHash, 'c'.repeat(64));
  await assert.rejects(f.service.recover('project', 'purchase', { role: 'query' }), { code: 'OBSERVATION_UNAVAILABLE' });
  assert.equal(f.calls.length, count);
});

test('default Console operation source retains its exact resolved plan and journal semantics', async t => {
  const f = await fixture(t); await f.imported();
  f.options.sources.reference.operationSources = {
    original: { directory: '/configured/workspace/operations/original', approvalsDirectory: '/configured/workspace/approvals' },
    second: { directory: '/configured/second', approvalsDirectory: '/configured/second-approvals' },
  };
  await f.restart();
  assert.equal((await f.service.importOperation('project', { id: 'purchase', reference: 'original' })).planHash, 'c'.repeat(64));
  assert.equal((await f.service.observe('project', 'purchase')).paymentCommitted, true);
  f.options.sources.reference.operationSources.original.approvalsDirectory = '/configured/different-approvals';
  await f.restart();
  await assert.rejects(f.service.recover('project', 'purchase', { role: 'commit' }), { code: 'OBSERVATION_UNAVAILABLE' });
});

test('schema1 registry migration requires exact original catalog before adding aliases', async t => {
  const f = await fixture(t);
  f.options.sources.reference.operationSources = { original: { directory: '/configured/original', approvalsDirectory: '/configured/original-approvals' } };
  await f.restart(); await f.imported(); await f.service.close();
  const path = resolve(f.directory, 'service.json');
  const legacy = JSON.parse(await readFile(path, 'utf8'));
  legacy.schema = 1; legacy.projects[0].configHash = canonicalHash(f.options.sources.reference);
  delete legacy.operations[0].sourceHash;
  await saveState(path, legacy);
  f.options.sources.reference.operationSources.second = { directory: '/configured/second', approvalsDirectory: '/configured/second-approvals' };
  await assert.rejects(f.restart(), /original complete source configuration/);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).schema, 1);
  delete f.options.sources.reference.operationSources.second;
  await f.restart(); assert.equal(JSON.parse(await readFile(path, 'utf8')).schema, 2);
  f.options.sources.reference.operationSources.second = { directory: '/configured/second', approvalsDirectory: '/configured/second-approvals' };
  await f.restart();
  assert.equal((await f.service.importOperation('project', { id: 'second', reference: 'second' })).planHash, 'd'.repeat(64));
});
