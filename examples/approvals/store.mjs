import { constants } from 'node:fs';
import { open, rename, realpath, stat } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { REPO, ensure, createPrivateRun, writeNew } from '../../packages/local-client/src/runtime.mjs';

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
