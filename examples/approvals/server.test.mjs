import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { request } from 'node:http';
import { createApprovalsServer } from './server.mjs';

async function freePort() {
  const probe = createServer(); await new Promise(done => probe.listen(0, '127.0.0.1', done));
  const port = probe.address().port; await new Promise(done => probe.close(done)); return port;
}
test('HTTP boundary: same-origin local session required; GET never invokes signing; no arbitrary file serving', async t => {
  const calls = [], port = await freePort(), origin = `http://127.0.0.1:${port}`;
  const service = { refresh: async () => calls.push('read'), projection: view => ({ schema: 1, view }),
    prepare: async input => { calls.push(['prepare', input]); return { accepted: true }; }, act: async () => { calls.push('action'); return {}; } };
  const server = createApprovalsServer(service, port); await new Promise(done => server.listen(port, '127.0.0.1', done));
  t.after(() => new Promise(done => server.close(done)));
  assert.equal((await fetch(origin + '/api/state')).status, 403);
  const page = await fetch(origin), cookie = page.headers.get('set-cookie').split(';')[0]; assert.equal(page.status, 200);
  assert(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
  assert.equal((await fetch(origin + '/api/state?view=public', { headers: { cookie } })).status, 200);
  assert.deepEqual(calls, ['read']);
  for (const bad of [{ Origin: 'https://attacker.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    assert.equal((await fetch(origin + '/api/prepare', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json', 'X-Cyperlink-Client': 'local-approvals', ...bad }, body: '{}' })).status, 403, JSON.stringify(bad));
  }
  const wrongHost = await new Promise((done, reject) => {
    const req = request(origin + '/api/state', { headers: { Host: 'attacker.invalid', cookie } }, res => { res.resume(); done(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(wrongHost, 403);
  assert.equal((await fetch(origin + '/api/prepare', { method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(origin + '/.local/secret.json', { headers: { cookie } })).status, 403);
  assert.deepEqual(calls, ['read']);
  assert.equal((await fetch(origin + '/api/prepare', { method: 'POST', headers: { cookie, Origin: origin, 'Content-Type': 'application/json', 'X-Cyperlink-Client': 'local-approvals' }, body: '{"consumer":"merchant","amount":40}' })).status, 202);
  assert.equal(calls[1][0], 'prepare');
});
