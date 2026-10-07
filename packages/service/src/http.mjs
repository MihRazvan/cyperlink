import { createServer } from 'node:http';
import { timingSafeEqual, randomUUID } from 'node:crypto';
import { ProjectService } from './service.mjs';
import { ServiceError, requireInput } from './errors.mjs';

const equal = (a, b) => typeof a === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
async function body(request) {
  if (request.headers['content-type'] !== 'application/json') throw new ServiceError('CONTENT_TYPE_REQUIRED', 'Use application/json.', 415);
  let size = 0; const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 8192) throw new ServiceError('BODY_TOO_LARGE', 'Request body exceeds 8192 bytes.', 413);
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ServiceError('INVALID_JSON', 'Expected a JSON object.', 400); }
}

/** Local v1 API. No browser cookies, signing keys, arbitrary paths or RPC URLs. */
export function createServiceServer(service, { token }) {
  requireInput(typeof token === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(token), 'Configure a bearer token of 32–256 URL-safe characters.');
  const server = createServer(async (request, response) => {
    const requestId = randomUUID();
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Request-Id', requestId);
    const json = (status, value) => {
      response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(value));
    };
    try {
      const host = `127.0.0.1:${server.address().port}`;
      if (request.headers.host !== host || request.headers.origin || request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'none') throw new ServiceError('LOCAL_CLIENT_REQUIRED', 'Use a local API client.', 403);
      if (!equal(request.headers.authorization, `Bearer ${token}`)) throw new ServiceError('UNAUTHENTICATED', 'A configured bearer token is required.', 401);
      const url = new URL(request.url, `http://${host}`);
      if (url.search) throw new ServiceError('INVALID_QUERY', 'Query parameters are not supported.', 400);
      const match = /^\/v1\/projects(?:\/([A-Za-z0-9][A-Za-z0-9_-]{0,99})(?:\/operations(?:\/([A-Za-z0-9][A-Za-z0-9_-]{0,99})(?:\/(observe|recover))?)?)?)?$/.exec(url.pathname);
      if (!match) throw new ServiceError('NOT_FOUND', 'Endpoint not found.', 404);
      const [, project, operation, action] = match;
      const operationsPath = url.pathname.includes('/operations');
      if (request.method === 'GET' && !action) {
        const data = !project ? service.listProjects() : !operationsPath ? service.getProject(project)
          : !operation ? service.listOperations(project) : service.getOperation(project, operation);
        return json(200, { apiVersion: 'v1', data });
      }
      if (request.method !== 'POST') throw new ServiceError('METHOD_NOT_ALLOWED', 'Unsupported method.', 405);
      const input = await body(request);
      let data;
      if (!project) data = await service.register(input);
      else if (operationsPath && !operation) data = await service.importOperation(project, input);
      else if (action === 'recover') data = await service.recover(project, operation, input);
      else if (action === 'observe') {
        requireInput(input && typeof input === 'object' && !Array.isArray(input) && Object.keys(input).length === 0, 'Observation takes an empty JSON object.');
        data = await service.observe(project, operation);
      } else throw new ServiceError('METHOD_NOT_ALLOWED', 'Unsupported method.', 405);
      return json(200, { apiVersion: 'v1', data });
    } catch (error) {
      const known = error instanceof ServiceError;
      json(known ? error.status : 503, { apiVersion: 'v1', error: { code: known ? error.code : 'SERVICE_UNAVAILABLE',
        message: known ? error.message : 'Unable to complete the request. Retained records are preserved.', requestId } });
    }
  });
  server.requestTimeout = 30_000; server.headersTimeout = 10_000;
  return server;
}

export async function startService({ port = 4331, token, ...options }) {
  requireInput(Number.isInteger(port) && port >= 0 && port <= 65535, 'Invalid local API port.');
  const service = await ProjectService.open(options);
  let server, closing;
  const close = () => closing ??= (async () => {
    try { if (server?.listening) await new Promise((done, fail) => server.close(error => error ? fail(error) : done())); }
    finally { await service.close(); }
  })();
  try {
    server = createServiceServer(service, { token });
    await new Promise((done, fail) => { server.once('error', fail); server.listen(port, '127.0.0.1', done); });
    return { service, server, close, url: `http://127.0.0.1:${server.address().port}` };
  } catch (error) { await close(); throw error; }
}
