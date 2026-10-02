#!/usr/bin/env node
import { createServer } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApprovalsService } from './service.mjs';
import { RealApprovalsAdapter } from './adapter.mjs';
import { PolicyApprovalsAdapter } from './policy-adapter.mjs';
import { privateJson, sessionDirectory, acquireSessionLock } from './store.mjs';

const publicDirectory = resolve(dirname(fileURLToPath(import.meta.url)), 'public');
const files = new Map([['/', ['index.html', 'text/html']], ['/app.mjs', ['app.mjs', 'text/javascript']], ['/style.css', ['style.css', 'text/css']]]);
const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export function createApprovalsServer(service, port) {
  const origin = `http://127.0.0.1:${port}`, session = randomBytes(32).toString('hex');
  return createServer(async (request, response) => {
    const json = (code, value) => { response.writeHead(code, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
    response.setHeader('Cache-Control', 'no-store'); response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      if (request.headers.host !== `127.0.0.1:${port}`) return json(403, { error: 'Only the configured loopback host is accepted' });
      if (request.headers.origin && request.headers.origin !== origin) return json(403, { error: 'Cross-origin requests are forbidden' });
      if (request.headers['sec-fetch-site'] === 'cross-site') return json(403, { error: 'Cross-site requests are forbidden' });
      const url = new URL(request.url, origin), route = files.get(url.pathname);
      if (route && request.method === 'GET') {
        if (url.pathname === '/') response.setHeader('Set-Cookie', `cyperlink_session=${session}; HttpOnly; SameSite=Strict; Path=/`);
        const bytes = await readFile(resolve(publicDirectory, route[0]));
        response.writeHead(200, { 'Content-Type': `${route[1]}; charset=utf-8` }); response.end(bytes); return;
      }
      const cookie = request.headers.cookie?.split(';').map(part => part.trim()).find(part => part.startsWith('cyperlink_session='))?.slice('cyperlink_session='.length);
      if (!equal(cookie, session)) return json(403, { error: 'Open the local Approvals page to establish this client session' });
      if (request.method === 'GET' && url.pathname === '/api/state') { await service.refresh(); return json(200, service.projection(url.searchParams.get('view') ?? 'owner')); }
      if (request.method !== 'POST' || request.headers['x-cyperlink-client'] !== 'local-approvals' || request.headers['content-type'] !== 'application/json') return json(403, { error: 'Explicit local client action required' });
      let body = ''; for await (const chunk of request) { body += chunk; if (body.length > 4096) return json(413, { error: 'Request too large' }); }
      const input = JSON.parse(body || '{}');
      if (url.pathname === '/api/prepare') return json(202, await service.prepare(input));
      const match = /^\/api\/operations\/([a-f0-9-]{36})\/([a-z-]+)$/.exec(url.pathname);
      if (match) return json(202, await service.act(match[1], match[2], input));
      return json(404, { error: 'Unknown local operation' });
    } catch (error) {
      // Runtime failures are reported through safe operation state; HTTP validation contains no private artifacts.
      json(400, { error: String(error.message).includes('ENOENT') ? 'Local artifact unavailable; inspect client setup' : String(error.message).slice(0, 250) });
    }
  });
}

/** Production defaults use the real adapter; host tests inject explicit fake factories. */
export async function startLockedApprovals({ bootstrap, directory, port, registerSignals = false,
  connect = (bootstrap, directory) => bootstrap.descriptor?.profile === 'local-custom-policy-v1'
    ? PolicyApprovalsAdapter.connect(bootstrap, directory) : RealApprovalsAdapter.connect(bootstrap, directory),
  openService = options => ApprovalsService.open(options),
}) {
  directory = await sessionDirectory(directory);
  const lock = await acquireSessionLock(directory);
  let service, server, startup, closeTask, stopping = false;
  const handlers = new Map();
  const close = () => closeTask ??= (async () => {
    stopping = true;
    // Startup and already-authorized work must quiesce before another process can own this session.
    await startup?.catch(() => {});
    if (server?.listening) await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await Promise.allSettled([service?.task, service?.refreshing, service?.saving]);
    try { return await lock.release(); }
    finally { for (const [signal, handler] of handlers) process.removeListener(signal, handler); }
  })();
  if (registerSignals) for (const signal of ['SIGINT', 'SIGTERM']) {
    const handler = () => { void close().then(() => process.exit(0), error => { console.error(error.message); process.exit(1); }); };
    handlers.set(signal, handler); process.on(signal, handler);
  }
  startup = (async () => {
    const adapter = await connect(bootstrap, directory); if (stopping) return;
    service = await openService({ directory, bootstrap: adapter.bootstrap ?? bootstrap, adapter }); if (stopping) return;
    server = createApprovalsServer(service, port);
    await new Promise((resolve, reject) => {
      const failed = error => { server.removeListener('listening', ready); reject(error); };
      const ready = () => { server.removeListener('error', failed); resolve(); };
      server.once('error', failed); server.once('listening', ready); server.listen(port, '127.0.0.1');
    });
  })();
  try { await startup; return { server, service, close }; }
  catch (error) { await close(); throw error; }
}

async function main() {
  const options = {}, allowed = new Set(['--bootstrap', '--session', '--port']);
  for (let i = 2; i < process.argv.length; i += 2) {
    const flag = process.argv[i]; if (!allowed.has(flag) || options[flag] || !process.argv[i + 1]) throw Error('Expected --bootstrap --session --port');
    options[flag] = process.argv[i + 1];
  }
  const port = Number(options['--port'] ?? 4317);
  if (!options['--bootstrap'] || !options['--session'] || !Number.isSafeInteger(port) || port < 1024 || port > 65535) throw Error('Require local bootstrap, session directory and unprivileged port');
  const bootstrap = await privateJson(options['--bootstrap']), directory = await sessionDirectory(options['--session']);
  const { server } = await startLockedApprovals({ bootstrap, directory, port, registerSignals: true });
  if (server?.listening) console.log(`CyperLink Approvals: http://127.0.0.1:${port} (local client; explicit approvals only)`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
