import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { REPO } from '../../../packages/local-client/src/runtime.mjs';
import { acquireSessionLock } from '../../../packages/local-client/src/private-store.mjs';
import { startConsole } from '../server.mjs';
import { setup } from './fixture.mjs';

test('exclusive private lock rejects a second Console before connecting its adapter', async t => {
  const f = await setup(t); let connections = 0;
  const options = { directory: f.directory, port: 0, connect: async () => { connections++; return f.adapter; } };
  const app = await startConsole(options);
  try {
    const path = resolve(f.directory, '.server.lock'), info = JSON.parse(await readFile(path));
    assert.equal(info.pid, process.pid); assert.equal((await stat(path)).mode & 0o777, 0o600);
    await assert.rejects(startConsole(options), /Session is locked/); assert.equal(connections, 1);
  } finally { await app.close(); }
  const reopened = await startConsole(options); await reopened.close(); assert.equal(connections, 2);
});

test('lock release is idempotent and never deletes a replacement lock', async t => {
  const { directory } = await setup(t), first = await acquireSessionLock(directory);
  assert.equal(await first.release(), true);
  const second = await acquireSessionLock(directory); await first.release();
  assert.equal(JSON.parse(await readFile(second.filename)).instance, second.info.instance);
  await rm(second.filename); await writeFile(second.filename, '{"replacement":true}', { mode: 0o600 });
  await assert.rejects(second.release(), /replaced/);
  assert.deepEqual(JSON.parse(await readFile(second.filename)), { replacement: true });
});

test('malformed, stale-PID and symlink locks fail closed without automatic removal', async t => {
  const { directory } = await setup(t), filename = resolve(directory, '.server.lock');
  for (const contents of ['', '{"pid":999999999,"startedAt":"1970-01-01"}']) {
    await writeFile(filename, contents, { mode: 0o600 });
    await assert.rejects(acquireSessionLock(directory), /Verify the previous process has stopped/);
    assert.equal(await readFile(filename, 'utf8'), contents); await rm(filename);
  }
  const target = resolve(directory, 'other'); await writeFile(target, 'do not touch', { mode: 0o600 }); await symlink(target, filename);
  await assert.rejects(acquireSessionLock(directory), /locked/); assert.equal(await readFile(target, 'utf8'), 'do not touch');
});

test('Console adapter and port binding failures release only their own workspace lock', async t => {
  const f = await setup(t);
  await assert.rejects(startConsole({ directory: f.directory, port: 0,
    connect: async () => { throw Error('Explicit host startup failure'); } }), /host startup failure/);
  const first = await startConsole({ directory: f.directory, port: 0, connect: async () => f.adapter });
  const other = await setup(t);
  try {
    await assert.rejects(startConsole({ directory: other.directory, port: first.server.address().port,
      connect: async () => other.adapter }), { code: 'EADDRINUSE' });
    const available = await acquireSessionLock(other.directory); await available.release();
    await assert.rejects(acquireSessionLock(f.directory), /locked/);
  } finally { await first.close(); }
});

test('Console close retains exclusion until already-authorized preparation has quiesced', async t => {
  const f = await setup(t); let finish, entered;
  const started = new Promise(done => { entered = done; });
  const original = f.adapter.prepare;
  f.adapter.prepare = async op => { entered(); await new Promise(done => { finish = done; }); return original(op); };
  const app = await startConsole({ directory: f.directory, port: 0, connect: async () => f.adapter });
  try {
    await app.service.prepare(f.request()); await started;
    const closing = app.close(); await assert.rejects(acquireSessionLock(f.directory), /locked/);
    finish(); await closing;
    assert.equal(f.calls.filter(call => call === 'prepare').length, 1);
    const next = await acquireSessionLock(f.directory); await next.release();
  } finally { finish?.(); await app.close(); }
});

test('real Console child process handles SIGTERM and releases its own lock', { timeout: 15_000 }, async t => {
  const f = await setup(t);
  const script = `import {startConsole} from './apps/console/server.mjs';
    const project=JSON.parse(process.argv[2]);
    await startConsole({directory:process.argv[1],port:0,registerSignals:true,connect:async()=>({project})});
    console.log('READY');`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', script, f.directory, JSON.stringify(f.adapter.project)],
    { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = ''; child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    const output = await once(child.stdout, 'data'); assert.match(String(output[0]), /READY/, stderr);
    await assert.rejects(acquireSessionLock(f.directory), /locked/);
    const exited = once(child, 'exit'); child.kill('SIGTERM');
    assert.deepEqual(await exited, [0, null], stderr);
    const replacement = await acquireSessionLock(f.directory); await replacement.release();
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, 'exit'); child.kill('SIGKILL'); await exited; }
  }
});

test('lock release refuses a changed instance record even when the inode is preserved', async t => {
  const { directory } = await setup(t), lock = await acquireSessionLock(directory);
  await writeFile(lock.filename, JSON.stringify({ ...lock.info, instance: 'different-owner' }));
  await assert.rejects(lock.release(), /identity changed/);
  assert.equal(JSON.parse(await readFile(lock.filename)).instance, 'different-owner');
});
