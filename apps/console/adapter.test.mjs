import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ConsoleAdapter, projectMetadata, verifiedBindings, verifyArtifacts } from './adapter.mjs';
import { descriptorDigest, validateOperation } from '../../packages/policy-client/src/index.mjs';
import { REPO } from '../../packages/local-client/src/runtime.mjs';
import { plan as nativePlan } from '../../packages/policy-client/test/fixture.mjs';
import { createHash } from 'node:crypto';

// All sessions below are explicit host doubles; these tests make no runtime claims.
const op = () => ({ id: 'request-1', title: 'Host test', amount: '12', sourceId: 'a', consumer: { kind: 'merchant', sku: '7' } });
async function fixture(t, overrides = {}) {
  await mkdir(resolve(REPO, '.local'), { recursive: true, mode: 0o700 });
  const directory = await mkdtemp(resolve(REPO, '.local/console-adapter-host-'));
  await chmod(directory, 0o700);
  t.after(() => rm(directory, { recursive: true, force: true }));
  const operations = resolve(directory, 'operations'); await mkdir(operations, { mode: 0o700 });
  const calls = [], descriptor = { hostTestOnly: true }, plan = { descriptor };
  const observation = { status: 'authorized' }, delivery = { status: 'confirmed' };
  const session = {
    prepare: async (...args) => { calls.push(['prepare', ...args]); return plan; },
    load: async path => { calls.push(['load', path]); return plan; },
    observe: async p => { calls.push(['observe', p]); return observation; },
    stageQuery: async (...args) => calls.push(['stageQuery', ...args]),
    stageCommit: async (...args) => calls.push(['stageCommit', ...args]),
    submit: async (...args) => { calls.push(['submit', ...args]); return { delivery, observation, ticket: { mustStayPrivate: true } }; },
    recover: async (...args) => { calls.push(['recover', ...args]); return { delivery, observation }; },
  };
  const adapter = new ConsoleAdapter({ directory, operations, session, instance: { descriptor,
    payerKeyfile: '/must-not-be-used', assetDirectories: { merchant: '/source-a', license: '/source-b' } },
    administratorKeyfile: '/explicit-admin', ownerKeyfiles: { a: '/explicit-a' }, ...overrides });
  adapter.assertRequestBinding = async () => {}; // Native artifact binding has separate concrete-file coverage below.
  return { adapter, session, calls, plan, directory };
}

test('project metadata configures only explicitly selected roles and exposes no key paths', () => {
  const instance = { policyName: 'example', descriptor: { releaseHashHex: 'aa', profile: 'local-custom-policy-v1', genesisHash: 'host-genesis' }, payerKeyfile: '/implicit-admin' };
  const keyless = projectMetadata(instance);
  assert.equal(keyless.signingEnabled, false); assert.equal(keyless.administratorConfigured, false);
  assert.deepEqual(keyless.sources.map(s => s.canSign), [false, false]);
  assert.equal(keyless.genesis, 'host-genesis'); assert.equal(keyless.deploymentHash, descriptorDigest(instance.descriptor));
  const configured = projectMetadata(instance, { administratorKeyfile: '/does-not-exist', ownerKeyfiles: { b: '/also-missing' } });
  assert.equal(configured.signingEnabled, true); assert.deepEqual(configured.sources.map(s => s.canSign), [false, true]);
  assert.equal(JSON.stringify(configured).includes('missing'), false);
  assert.throws(() => projectMetadata(instance, { ownerKeyfiles: { c: '/unknown-role' } }));
});

test('project refresh reads the current confirmed slot without touching signer or operation paths', async () => {
  const calls = [], project = { slot: 10 };
  const adapter = new ConsoleAdapter({ project, session: { connection: { getSlot: async commitment => { calls.push(commitment); return 25; } } } });
  assert.equal(await adapter.refreshProject(), project);
  assert.deepEqual(calls, ['confirmed']); assert.equal(project.slot, 25);
  adapter.session.connection.getSlot = async () => '26';
  await assert.rejects(adapter.refreshProject(), /confirmed project slot/); assert.equal(project.slot, 25);
});

test('prepare binds selected source and explicit signers; repeat cannot prepare again', async t => {
  const { adapter, calls, plan } = await fixture(t), operation = op();
  const result = await adapter.prepare(operation);
  assert.equal(result.planHash, descriptorDigest(plan.descriptor));
  assert.equal(calls[0][1].directory, adapter.path(operation));
  assert.equal(calls[0][1].provisionedDirectory, '/source-a');
  assert.equal(calls[0][1].amount, 12);
  assert.deepEqual(calls[0][2], { ownerKeyfile: '/explicit-a', administratorKeyfile: '/explicit-admin' });
  await assert.rejects(adapter.prepare(operation), { code: 'PREPARATION_ALREADY_STARTED' });
  assert.equal(calls.filter(c => c[0] === 'prepare').length, 1);
  assert.equal((await adapter.inspect(operation)).planHash, result.planHash);
});

test('missing selected owner or admin never adopts payer or another wallet', async t => {
  const { adapter, calls } = await fixture(t);
  await assert.rejects(adapter.prepare({ ...op(), sourceId: 'b' }), { code: 'SIGNERS_REQUIRED' });
  adapter.administratorKeyfile = undefined;
  await assert.rejects(adapter.prepare(op()), { code: 'SIGNERS_REQUIRED' });
  assert.equal(calls.length, 0);
});

test('native amounts remain exact below 2^48 and invalid requests never start preparation', async t => {
  const { adapter, calls } = await fixture(t);
  for (const amount of ['0', '-1', '01', '1.2', '281474976710656', 12]) {
    await assert.rejects(adapter.prepare({ ...op(), amount }));
  }
  assert.equal(calls.length, 0);
  await adapter.prepare({ ...op(), amount: '281474976710655' });
  assert.equal(calls[0][1].amount, 281474976710655);
});

test('changed plan or retained operation identity fails before observation and signing', async t => {
  const { adapter, calls } = await fixture(t), operation = op();
  Object.assign(operation, await adapter.prepare(operation)); calls.length = 0;
  await assert.rejects(adapter.approve({ ...operation, planHash: 'bb'.repeat(32) }, 'query'), /plan identity/);
  assert.equal(calls.some(c => c[0].startsWith('stage')), false);
  for (const changed of [{ amount: '13' }, { sourceId: 'b' }, { consumer: { kind: 'merchant', sku: '8' } }]) {
    await assert.rejects(adapter.observe({ ...operation, ...changed }), /retained console intent/);
  }
  await assert.rejects(adapter.observe({ ...operation, id: '../request-1' }), /identifier/);
});

test('approve uses separate public SDK roles and strips internal ticket', async t => {
  const { adapter, calls } = await fixture(t), operation = op();
  Object.assign(operation, await adapter.prepare(operation)); calls.length = 0;
  assert.deepEqual(Object.keys(await adapter.approve(operation, 'query')).sort(), ['delivery', 'observation']);
  assert.deepEqual(calls.map(c => c[0]), ['load', 'stageQuery', 'submit']);
  calls.length = 0; await adapter.approve(operation, 'commit');
  assert.deepEqual(calls.map(c => c[0]), ['load', 'stageCommit', 'submit']);
  await assert.rejects(adapter.approve(operation, 'other'), /role/);
});

test('keyless recovery and explicit resubmit retain the original plan without any signing', async t => {
  const { adapter, calls } = await fixture(t), operation = op();
  Object.assign(operation, await adapter.prepare(operation)); calls.length = 0;
  adapter.ownerKeyfiles = {}; adapter.administratorKeyfile = undefined;
  await adapter.recover(operation, 'query');
  await adapter.recover(operation, 'commit', true);
  assert.deepEqual(calls.map(c => c[0]), ['load', 'recover', 'load', 'submit']);
});

test('interrupted preparation never automatically re-signs and complete plans remain discoverable', async t => {
  const { adapter, session, calls } = await fixture(t), operation = op();
  session.prepare = async () => { throw Error('host interruption'); };
  await assert.rejects(adapter.prepare(operation), /host interruption/);
  await assert.rejects(adapter.prepare(operation), { code: 'PREPARATION_ALREADY_STARTED' });
  session.load = async () => { throw Object.assign(Error('missing'), { code: 'ENOENT' }); };
  await assert.rejects(adapter.inspect(operation), { code: 'PREPARATION_INCOMPLETE' });
  assert.equal(calls.length, 0);
});

test('discovery binds consumer, wallet and clear amount to retained native request and witness', async t => {
  const { adapter, directory } = await fixture(t), operation = op(), plan = nativePlan();
  plan.label = `console-${createHash('sha256').update(operation.id).digest('hex').slice(0, 32)}`;
  const { template } = validateOperation(plan.descriptor);
  const operationDirectory = adapter.path(operation), assets = resolve(directory, 'assets');
  await mkdir(operationDirectory, { mode: 0o700 }); await mkdir(assets, { mode: 0o700 });
  adapter.instance.assetDirectories.merchant = assets;
  const request = { amount: 12, owner: plan.descriptor.owner, source: template.source, destination: template.destination, mint: template.mint };
  const provisioned = { source_owner: request.owner, accounts: Object.fromEntries(['source', 'destination', 'mint'].map(key => [key, { address: request[key] }])) };
  const witness = { amount: 12, commitment: [...template.amountCommitment] };
  const save = (name, value) => writeFile(resolve(operationDirectory, name), JSON.stringify(value), { mode: 0o600 });
  await save('request.json', request); await save('operation-witness.json', witness);
  await writeFile(resolve(assets, 'provisioned.json'), JSON.stringify(provisioned), { mode: 0o600 });
  const check = () => ConsoleAdapter.prototype.assertRequestBinding.call(adapter, operation, plan);
  await check();
  plan.descriptor.sku = '8'; await assert.rejects(check()); plan.descriptor.sku = '7';
  await save('request.json', { ...request, amount: 13 }); await assert.rejects(check(), /source or amount/); await save('request.json', request);
  await save('operation-witness.json', { ...witness, amount: 13 }); await assert.rejects(check(), /witness/);
  await save('operation-witness.json', { ...witness, commitment: Array(32).fill(0) }); await assert.rejects(check(), /witness/);
  await save('operation-witness.json', witness);
  await writeFile(resolve(assets, 'provisioned.json'), JSON.stringify({ ...provisioned, source_owner: request.destination }), { mode: 0o600 });
  await assert.rejects(check(), /source or amount/);
});

test('changed generated bindings are rejected before evaluating local code', async t => {
  const { directory } = await fixture(t), hash = 'aa'.repeat(32);
  const releaseDirectory = resolve(directory, '.cyperlink/releases', hash);
  await mkdir(releaseDirectory, { recursive: true });
  await writeFile(resolve(directory, '.cyperlink/bindings.mjs'), 'throw Error("must never execute");');
  await assert.rejects(verifiedBindings({ releaseDirectory }, { releaseHashHex: hash, package: { stateFields: [] } }), /bindings changed/);
});

test('all eight authenticated circuit artifacts are required and changed bytes fail closed', async t => {
  const { directory } = await fixture(t), release = { artifacts: {} };
  await assert.rejects(verifyArtifacts({ releaseDirectory: directory }, release), /complete/);
  await mkdir(resolve(directory, 'circuits'));
  for (const stem of ['init', 'evaluate']) for (const suffix of ['arcis', 'idarc', 'hash', 'weight']) {
    const name = `runtime_policy_${stem}.${suffix}`;
    release.artifacts[name] = { sha256: '00'.repeat(32), bytes: 5 };
    await writeFile(resolve(directory, 'circuits', name), 'wrong');
  }
  await assert.rejects(verifyArtifacts({ releaseDirectory: directory }, release), /differs/);
});
