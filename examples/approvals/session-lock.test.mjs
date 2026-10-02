import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, chmod, rm, readFile, writeFile, stat, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { REPO } from '../../packages/local-client/src/runtime.mjs';
import { acquireSessionLock } from './store.mjs';
import { startLockedApprovals } from './server.mjs';

async function directory(t) {
  const path = await mkdtemp(resolve(REPO, '.local/approvals-lock-test-')); await chmod(path, 0o700);
  t.after(() => rm(path, { recursive: true, force: true })); return path;
}
const fakeService = { refresh: async () => {}, projection: () => ({}), task: null };

test('exclusive private lock prevents second server before adapter or state mutation', async t => {
  const path = await directory(t); let connections = 0;
  const options = { bootstrap: {}, directory: path, port: 0, connect: async () => { connections++; return {}; }, openService: async () => fakeService };
  const server = await startLockedApprovals(options);
  try {
    const info = JSON.parse(await readFile(resolve(path, '.server.lock')));
    assert.equal(info.pid, process.pid); assert.equal((await stat(resolve(path, '.server.lock'))).mode & 0o777, 0o600);
    await assert.rejects(startLockedApprovals(options), /Session is locked/); assert.equal(connections, 1);
  } finally { await server.close(); }
  const reopened = await startLockedApprovals(options); await reopened.close(); assert.equal(connections, 2);
});

test('release is idempotent and never deletes a replacement lock', async t => {
  const path = await directory(t), first = await acquireSessionLock(path);
  assert.equal(await first.release(), true);
  const second = await acquireSessionLock(path); await first.release();
  assert.equal(JSON.parse(await readFile(second.filename)).instance, second.info.instance);
  await rm(second.filename); await writeFile(second.filename, '{"replacement":true}', { mode: 0o600 });
  await assert.rejects(second.release(), /replaced/);
  assert.deepEqual(JSON.parse(await readFile(second.filename)), { replacement: true });
});

test('existing malformed, stale-PID and symlink locks fail closed without automatic removal', async t => {
  const path = await directory(t), filename = resolve(path, '.server.lock');
  for (const contents of ['', '{"pid":999999999,"startedAt":"1970-01-01"}']) {
    await writeFile(filename, contents, { mode: 0o600 }); await assert.rejects(acquireSessionLock(path), /Verify the previous process has stopped/);
    assert.equal(await readFile(filename, 'utf8'), contents); await rm(filename);
  }
  const target = resolve(path, 'other'); await writeFile(target, 'do not touch', { mode: 0o600 }); await symlink(target, filename);
  await assert.rejects(acquireSessionLock(path), /locked/); assert.equal(await readFile(target, 'utf8'), 'do not touch');
});

test('adapter startup failure and port binding failure release only the acquired session lock', async t => {
  const path = await directory(t);
  await assert.rejects(startLockedApprovals({ bootstrap: {}, directory: path, port: 0,
    connect: async () => { throw Error('Explicit host startup failure'); } }), /host startup failure/);
  const first = await startLockedApprovals({ bootstrap: {}, directory: path, port: 0, connect: async () => ({}), openService: async () => fakeService });
  const otherPath = await directory(t);
  try {
    await assert.rejects(startLockedApprovals({ bootstrap: {}, directory: otherPath, port: first.server.address().port,
      connect: async () => ({}), openService: async () => fakeService }), { code: 'EADDRINUSE' });
    const available = await acquireSessionLock(otherPath); await available.release();
    await assert.rejects(acquireSessionLock(path), /locked/);
  } finally { await first.close(); }
});

test('graceful close retains exclusion until already-authorized work has quiesced', async t => {
  const path = await directory(t); let finish;
  const service = { ...fakeService, task: new Promise(resolve => { finish = resolve; }) };
  const instance = await startLockedApprovals({ bootstrap: {}, directory: path, port: 0, connect: async () => ({}), openService: async () => service });
  const closing = instance.close(); await assert.rejects(acquireSessionLock(path), /locked/);
  finish(); await closing;
  const next = await acquireSessionLock(path); await next.release();
});

test('real child process handles SIGTERM and releases its own lock', async t => {
  const path = await directory(t);
  const script = `import {startLockedApprovals} from './examples/approvals/server.mjs';
    await startLockedApprovals({bootstrap:{},directory:process.argv[1],port:0,registerSignals:true,
      connect:async()=>({}),openService:async()=>({refresh:async()=>{},projection:()=>({})})});
    console.log('READY');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, path], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const output = await once(child.stdout, 'data'); assert.match(String(output[0]), /READY/, stderr);
    await assert.rejects(acquireSessionLock(path), /locked/);
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    assert.deepEqual(await exited, [0, null], stderr);
    const replacement = await acquireSessionLock(path); await replacement.release();
  } finally { if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; } }
});


test('release refuses a changed instance record even when the inode is preserved', async t => {
  const path = await directory(t), lock = await acquireSessionLock(path);
  await writeFile(lock.filename, JSON.stringify({ ...lock.info, instance: 'different-owner' }));
  await assert.rejects(lock.release(), /identity changed/);
  assert.equal(JSON.parse(await readFile(lock.filename)).instance, 'different-owner');
});
