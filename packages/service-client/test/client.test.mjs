import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { CyperLinkServiceClient, CyperLinkServiceError } from '../src/index.mjs';

const token = 'host-test-token-'.repeat(3);
async function server(t, handler) {
  const instance = createServer(handler);
  await new Promise(resolve => instance.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { instance.closeAllConnections(); instance.close(resolve); }));
  return `http://127.0.0.1:${instance.address().port}`;
}
test('HTTP contract uses exact routes, resource IDs and configured bearer', async t => {
  const requests = [];
  const endpoint = await server(t, async (request, response) => {
    let body = ''; for await (const chunk of request) body += chunk;
    assert.equal(request.headers.authorization, `Bearer ${token}`);
    requests.push([request.method, request.url, body ? JSON.parse(body) : null]);
    response.end(JSON.stringify({ apiVersion: 'v1', data: { retained: true } }));
  });
  const client = new CyperLinkServiceClient({ endpoint, token });
  await client.registerProject({ id: 'app', source: 'local' });
  await client.importOperation('app', { id: 'purchase', reference: 'original' });
  await client.observe('app', 'purchase');
  await client.recover('app', 'purchase', 'commit');
  await client.getOperation('app', 'purchase');
  assert.deepEqual(requests, [
    ['POST', '/v1/projects', { id: 'app', source: 'local' }],
    ['POST', '/v1/projects/app/operations', { id: 'purchase', reference: 'original' }],
    ['POST', '/v1/projects/app/operations/purchase/observe', {}],
    ['POST', '/v1/projects/app/operations/purchase/recover', { role: 'commit' }],
    ['GET', '/v1/projects/app/operations/purchase', null],
  ]);
});
test('structured failures retain status, code and request correlation', async t => {
  const endpoint = await server(t, (_request, response) => {
    response.writeHead(409, { 'X-Request-Id': 'request-123' });
    response.end(JSON.stringify({ apiVersion: 'v1', error: { code: 'IDENTITY_CONFLICT', message: 'Already bound.' } }));
  });
  const client = new CyperLinkServiceClient({ endpoint, token });
  await assert.rejects(client.getProject('app'), error => error instanceof CyperLinkServiceError && error.code === 'IDENTITY_CONFLICT' && error.status === 409 && error.requestId === 'request-123');
});
test('lost responses are unresolved and never automatically retried', async t => {
  let count = 0;
  const endpoint = await server(t, (request) => { count++; request.socket.destroy(); });
  await assert.rejects(new CyperLinkServiceClient({ endpoint, token }).registerProject({ id: 'app', source: 'local' }), { code: 'TRANSPORT_UNRESOLVED' });
  assert.equal(count, 1);
});
test('cancellation and deadline stop waiting without retry', async t => {
  const endpoint = await server(t, () => {});
  await assert.rejects(new CyperLinkServiceClient({ endpoint, token, timeoutMs: 20 }).listProjects(), { code: 'REQUEST_ABORTED' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(new CyperLinkServiceClient({ endpoint, token }).listProjects({ signal: controller.signal }), { code: 'REQUEST_ABORTED' });
});
test('protocol mismatches and redirects fail without following credential-bearing requests', async t => {
  let redirected = 0;
  const endpoint = await server(t, (request, response) => {
    if (request.url === '/elsewhere') { redirected++; response.end('{}'); }
    else { response.writeHead(302, { Location: '/elsewhere' }); response.end(); }
  });
  await assert.rejects(new CyperLinkServiceClient({ endpoint, token }).listProjects(), { code: 'TRANSPORT_UNRESOLVED' });
  assert.equal(redirected, 0);
  const client = new CyperLinkServiceClient({ endpoint, token, fetch: async () => new Response(JSON.stringify({ apiVersion: 'v2', data: [] })) });
  await assert.rejects(client.listProjects(), { code: 'PROTOCOL_MISMATCH' });
});
test('reject invalid origins and identifiers before sending requests', () => {
  assert.throws(() => new CyperLinkServiceClient({ endpoint: 'http://example.com', token }));
  assert.throws(() => new CyperLinkServiceClient({ endpoint: 'https://example.com/v1', token }));
  const client = new CyperLinkServiceClient({ endpoint: 'http://127.0.0.1:4331', token });
  assert.throws(() => client.getProject('../app'));
  assert.throws(() => client.recover('app', 'purchase', 'resign'));
});
