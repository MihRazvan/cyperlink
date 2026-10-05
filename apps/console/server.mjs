#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConsoleService, ConsoleError } from './service.mjs';
import { ConsoleAdapter } from './adapter.mjs';
import { acquireSessionLock, sessionDirectory } from '../../packages/local-client/src/private-store.mjs';

const assets = new Map([['/', ['index.html', 'text/html']], ['/app.mjs', ['app.mjs', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
const directory = resolve(dirname(fileURLToPath(import.meta.url)), 'public');
const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createConsoleServer(service) {
  const session = randomBytes(32).toString('hex');
  const server = createServer(async (request, response) => {
    const json = (status, value) => { response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); response.end(JSON.stringify(value)); };
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer'); response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const host = `127.0.0.1:${server.address().port}`, origin = `http://${host}`;
      if (request.headers.host !== host || request.headers.origin && request.headers.origin !== origin || ['cross-site', 'same-site'].includes(request.headers['sec-fetch-site'])) return json(403, { error: 'Open this Console directly on its configured local address.' });
      const cookieName = `cyperlink_console_${server.address().port}`;
      const url = new URL(request.url, origin), asset = assets.get(url.pathname);
      if (request.method === 'GET' && asset) {
        if (url.pathname === '/') response.setHeader('Set-Cookie', `${cookieName}=${session}; HttpOnly; SameSite=Strict; Path=/`);
        const bytes = await readFile(resolve(directory, asset[0]));
        response.writeHead(200, { 'Content-Type': `${asset[1]}; charset=utf-8` }); response.end(bytes); return;
      }
      const cookie = request.headers.cookie?.split(';').map(x => x.trim()).find(x => x.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
      if (!equal(cookie, session)) return json(403, { error: 'Open Console to establish a local session.' });
      if (request.method === 'GET' && url.pathname === '/api/state') return json(200, await service.refresh());
      if (request.method !== 'POST' || request.headers.origin && request.headers.origin !== origin || request.headers['x-cyperlink-client'] !== 'console' || request.headers['content-type'] !== 'application/json') return json(403, { error: 'An explicit local Console action is required.' });
      let size = 0, chunks = [];
      for await (const chunk of request) { size += chunk.length; if (size > 8192) { json(413, { error: 'Request exceeds the supported size.' }); request.resume(); return; } chunks.push(chunk); }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString()); }
      catch { return json(400, { error: 'Expected a JSON action.' }); }
      if (url.pathname === '/api/operations') return json(202, await service.prepare(input));
      const match = /^\/api\/operations\/([a-f0-9-]{36})\/(approve-query|approve-payment|recover-query|recover-payment|submit-query|submit-payment|refresh)$/.exec(url.pathname);
      if (match) return json(202, await service.act(match[1], match[2], input));
      return json(404, { error: 'Action not found.' });
    } catch (error) {
      json(error instanceof ConsoleError ? error.status : 503, { code: error instanceof ConsoleError ? error.code : 'CONSOLE_UNAVAILABLE',
        error: error instanceof ConsoleError ? error.message : 'Console could not complete this request. Retained local records have been preserved.' });
    }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  return server;
}
export async function startConsole({ instancePath, directory, administratorKeyfile, ownerKeyfiles = {}, port = 4321,
  connect = options => ConsoleAdapter.connect(options), registerSignals = false }) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConsoleError('INVALID_PORT', 'Invalid Console port.');
  directory = await sessionDirectory(directory);
  const lock = await acquireSessionLock(directory); let server, service, closeTask; const handlers = new Map();
  const close = () => closeTask ??= (async () => {
    try {
      // Drain HTTP requests before inspecting service.task: a request may be persisting intent.
      if (server?.listening) await new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
      await service?.close();
    } finally { await lock.release(); for (const [signal, handler] of handlers) process.removeListener(signal, handler); }
  })();
  try {
    const adapter = await connect({ instancePath, directory, administratorKeyfile, ownerKeyfiles });
    service = await ConsoleService.open({ directory, adapter }); server = createConsoleServer(service);
    await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
    if (registerSignals) for (const signal of ['SIGINT', 'SIGTERM']) {
      const handler = () => { void close().then(() => process.exit(0), () => process.exit(1)); };
      handlers.set(signal, handler); process.on(signal, handler);
    }
    return { server, service, close, url: `http://127.0.0.1:${server.address().port}` };
  } catch (error) { await close(); throw error; }
}
export async function main(args = process.argv.slice(2)) {
  const opts = {}, flags = new Set(['--instance', '--directory', '--administrator', '--owner-a', '--owner-b', '--port']);
  for (let i = 0; i < args.length; i += 2) {
    if (!flags.has(args[i]) || Object.hasOwn(opts, args[i]) || !args[i + 1]) throw Error('Use console --instance INSTANCE --directory NEW_OR_RETAINED_WORKSPACE [--administrator KEYFILE --owner-a KEYFILE --owner-b KEYFILE --port 4321]');
    opts[args[i]] = args[i + 1];
  }
  if (!opts['--instance'] || !opts['--directory']) throw Error('Console requires --instance and --directory. Omit signing options for keyless observation and recovery.');
  const port = opts['--port'] === undefined ? 4321 : Number(opts['--port']);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('Choose an unprivileged local port (1024–65535).');
  const ownerKeyfiles = {};
  if (opts['--owner-a']) ownerKeyfiles.a = resolve(opts['--owner-a']);
  if (opts['--owner-b']) ownerKeyfiles.b = resolve(opts['--owner-b']);
  const result = await startConsole({ instancePath: resolve(opts['--instance']), directory: resolve(opts['--directory']),
    administratorKeyfile: opts['--administrator'] && resolve(opts['--administrator']), ownerKeyfiles, port, registerSignals: true });
  console.log(`CyperLink Console: ${result.url}`);
  console.log(result.service.adapter.project.signingEnabled ? 'Local signing configured. Preparation, private queries and payments each require explicit approval.' : 'Keyless session. Observe and recover; explicit submission can use only retained signed bytes.');
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
