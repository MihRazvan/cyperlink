import { constants } from 'node:fs';
import { open, rename, realpath, stat, lstat, unlink } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { REPO, ensure, createPrivateRun, writeNew } from './runtime.mjs';

export async function privateJson(filename) {
  const path = resolve(filename);
  ensure(path.startsWith(resolve(REPO, '.local') + sep) && await realpath(path) === path, 'Expected nonsymlink local artifact');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    ensure(info.isFile() && info.uid === process.getuid() && !(info.mode & 0o077) && info.size < 8 * 1024 * 1024, 'Expected private bounded artifact');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}
export async function sessionDirectory(path) {
  const directory = resolve(path);
  try { return await createPrivateRun(directory); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  ensure(directory.startsWith(resolve(REPO, '.local') + sep) && await realpath(directory) === directory, 'Expected local nonsymlink session');
  const info = await stat(directory);
  ensure(info.isDirectory() && info.uid === process.getuid() && !(info.mode & 0o077), 'Expected private session directory');
  return directory;
}
export async function saveState(filename, value) {
  const temp = resolve(dirname(filename), `.state-${randomUUID()}.tmp`);
  await writeNew(temp, JSON.stringify(value, null, 2));
  await rename(temp, filename);
  const directory = await open(dirname(filename), constants.O_RDONLY);
  try { await directory.sync(); } finally { await directory.close(); }
}

/** File presence is the lock. A crash deliberately requires explicit operator reconciliation. */
export async function acquireSessionLock(path) {
  const directory = await sessionDirectory(path), filename = resolve(directory, '.server.lock');
  let handle;
  try { handle = await open(filename, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600); }
  catch (error) {
    if (error.code === 'EEXIST' || error.code === 'ELOOP') throw Error('Session is locked by another server or an interrupted process. Verify the previous process has stopped before explicitly removing .server.lock. No PID-based automatic removal is performed.');
    throw error;
  }
  const identity = await handle.stat(), info = Object.freeze({ schema: 1, pid: process.pid, instance: randomUUID(), startedAt: new Date().toISOString() });
  let initialized = false;
  const syncParent = async () => { const parent = await open(directory, constants.O_RDONLY); try { await parent.sync(); } finally { await parent.close(); } };
  let releaseTask;
  const release = () => releaseTask ??= (async () => {
    try {
      let current;
      try { current = await lstat(filename); } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
      ensure(current.isFile() && current.dev === identity.dev && current.ino === identity.ino, 'Session lock was replaced; refusing to remove another lock');
      if (initialized) {
        const retained = await privateJson(filename);
        ensure(retained.instance === info.instance && retained.pid === info.pid, 'Session lock identity changed; refusing to remove another lock');
      }
      await unlink(filename); await syncParent(); return true;
    } finally { await handle.close(); }
  })();
  try { await handle.writeFile(JSON.stringify(info, null, 2) + '\n'); await handle.sync(); await syncParent(); initialized = true; }
  catch (error) { await release(); throw error; }
  return { filename, info, release };
}
