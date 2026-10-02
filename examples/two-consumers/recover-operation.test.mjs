import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, symlink, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseArguments, readRetainedJson, runRecovery, assertTicketBinding } from './recover-operation.mjs';
import { descriptorDigest } from '../../packages/local-client/src/operation-plan.mjs';

const execute = promisify(execFile);
async function fixture(t) {
  const local = resolve('.local'); await mkdir(local, { recursive: true });
  const directory = await mkdtemp(resolve(local, 'recovery-worker-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const plan = { schema: 1, genesisHash: 'genesis', descriptor: { job: 'job', computation: 'computation', permit: 'permit', owner: 'owner', quota: 'quota', effect: 'effect' } };
  const path = resolve(directory, 'operation-plan.json'), ticket = resolve(directory, 'ticket.json');
  await writeFile(path, JSON.stringify(plan), { mode: 0o600 });
  await writeFile(ticket, JSON.stringify({ signature: 'same-signature', signedWire: 'SENSITIVE_WIRE_SENTINEL' }), { mode: 0o600 });
  const options = { plan: path, ticket, action: 'observe', output: resolve(directory, 'result.json') };
  const calls = [];
  const adapter = { genesisHash: async () => 'genesis', validatePlan: async () => {},
    observe: async () => ({ status: 'authorized', job: 'job' }),
    recoverTicket: async (_plan, ticket) => { calls.push('recover'); return { status: 'unobserved', signature: ticket.signature }; },
    submitTicket: async (_plan, ticket) => { calls.push('submit'); return { status: 'confirmed', signature: ticket.signature }; } };
  return { directory, path, plan, options, calls, adapter };
}

test('CLI accepts only explicit recovery actions and never accepts signer arguments', () => {
  const args = ['--plan', 'plan', '--rpc', 'http://127.0.0.1:8899', '--module-root', 'modules', '--action', 'observe', '--out', 'out'];
  assert.equal(parseArguments(args).action, 'observe');
  assert.throws(() => parseArguments([...args, '--owner-keyfile', 'secret']), /supported/);
  assert.throws(() => parseArguments([...args, '--action', 'submit-ticket']), /Duplicate/);
  assert.throws(() => parseArguments(args.map(x => x === 'http://127.0.0.1:8899' ? 'https://api.mainnet-beta.solana.com' : x)), /loopback/);
  assert.throws(() => parseArguments(args.map(x => x === 'observe' ? 'submit-ticket' : x)), /Ticket/);
  assert.equal(parseArguments([...args.map(x => x === 'observe' ? 'submit-ticket' : x), '--ticket', 'ticket', '--role', 'query']).role, 'query');
});

test('ticket binding rejects swapped descriptor, role, and validator identity', () => {
  const plan = { genesisHash: 'genesis', descriptor: { job: 'job', effect: 'effect' } }, ticket = { genesisHash: 'genesis' };
  const record = { genesisHash: 'genesis', role: 'query', descriptorSha256: descriptorDigest(plan.descriptor) };
  assert.doesNotThrow(() => assertTicketBinding(plan, ticket, record, 'query'));
  assert.throws(() => assertTicketBinding({ ...plan, descriptor: { ...plan.descriptor, effect: 'different' } }, ticket, record, 'query'), /descriptor/);
  assert.throws(() => assertTicketBinding(plan, ticket, record, 'commit'), /role/);
  assert.throws(() => assertTicketBinding(plan, { genesisHash: 'different' }, record, 'query'), /genesis/);
});

test('read-only recovery never submits and preserves retained operation identity', async t => {
  const f = await fixture(t); f.options.action = 'recover-ticket';
  const result = await runRecovery(f.options, f.adapter);
  assert.deepEqual(f.calls, ['recover']);
  assert.deepEqual(result.identity, f.plan.descriptor);
  assert.equal(result.delivery.signature, 'same-signature');
  assert.equal(result.generatesKeysProofsOrOperationIdentity, false);
  assert.ok(!JSON.stringify(result).includes('SENSITIVE_WIRE_SENTINEL'));
  assert.deepEqual(JSON.parse(await readFile(f.path)), f.plan);
});

test('only explicit submit-ticket calls submission once', async t => {
  const f = await fixture(t); f.options.action = 'submit-ticket';
  const result = await runRecovery(f.options, f.adapter);
  assert.deepEqual(f.calls, ['submit']); assert.equal(result.delivery.signature, 'same-signature');
});

test('wrong genesis rejects before ticket recovery or submission', async t => {
  const f = await fixture(t); f.options.action = 'submit-ticket';
  f.adapter.genesisHash = async () => 'different-genesis';
  await assert.rejects(runRecovery(f.options, f.adapter), /different validator genesis/);
  assert.deepEqual(f.calls, []);
});

test('existing output rejects before any network action', async t => {
  const f = await fixture(t); f.options.action = 'submit-ticket';
  await writeFile(f.options.output, 'preserve', { mode: 0o600 });
  f.adapter.genesisHash = async () => { throw Error('must not call RPC'); };
  await assert.rejects(runRecovery(f.options, f.adapter), /already exists/);
  assert.equal(await readFile(f.options.output, 'utf8'), 'preserve');
});

test('retained files reject public permissions and symlinks', async t => {
  const f = await fixture(t);
  const publicPath = resolve(f.directory, 'public.json'); await writeFile(publicPath, '{}', { mode: 0o644 });
  await assert.rejects(readRetainedJson(publicPath), /private regular/);
  const linked = resolve(f.directory, 'linked.json'); await symlink(f.path, linked);
  await assert.rejects(readRetainedJson(linked), /symlinks/);
});

test('fresh Node process reconstructs solely from retained plan: host harness qualification', async t => {
  const f = await fixture(t), module = new URL('./recover-operation.mjs', import.meta.url).href;
  const script = `import {runRecovery} from ${JSON.stringify(module)}; const result=await runRecovery(${JSON.stringify(f.options)}, {genesisHash:async()=> 'genesis',validatePlan:async()=>{},observe:async()=>({status:'authorized'})}); console.log(JSON.stringify(result));`;
  const { stdout } = await execute(process.execPath, ['--input-type=module', '-e', script]);
  const result = JSON.parse(stdout);
  assert.notEqual(result.processId, process.pid);
  assert.deepEqual(result.identity, f.plan.descriptor);
  assert.equal(result.observation.status, 'authorized');
  assert.equal(result.createsNewSignedTransaction, false);
});
