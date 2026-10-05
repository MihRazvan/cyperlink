import { request } from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { startConsole } from '../server.mjs';
import { setup } from './fixture.mjs';

test('local browser boundary requires session, exact origin and explicit action; GET cannot sign', async t => {
  const f = await setup(t);
  const app = await startConsole({ directory: f.directory, port: 0, connect: async () => f.adapter }); t.after(() => app.close());
  assert.equal((await fetch(`${app.url}/api/state`)).status, 403);
  const home = await fetch(app.url), cookie = home.headers.get('set-cookie').split(';')[0];
  assert.match(home.headers.get('content-security-policy'), /frame-ancestors 'none'/); assert.match(cookie, /cyperlink_console_\d+=/);
  const headers = { Cookie: cookie, 'Content-Type': 'application/json', 'X-Cyperlink-Client': 'console' };
  for (const override of [{ Origin: 'https://unrelated.invalid' }, { Host: 'unrelated.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    const status = await new Promise((done, fail) => {
      const call = request(`${app.url}/api/operations`, { method: 'POST', headers: { ...headers, ...override } }, response => { response.resume(); done(response.statusCode); });
      call.on('error', fail); call.end(JSON.stringify(f.request()));
    });
    assert.equal(status, 403, JSON.stringify(override));
  }
  assert.equal((await fetch(`${app.url}/api/state`, { headers })).status, 200);
  assert.equal(f.calls.filter(x => x === 'prepare' || x.startsWith('approve')).length, 0);
  const response = await fetch(`${app.url}/api/operations`, { method: 'POST', headers, body: JSON.stringify(f.request()) });
  assert.equal(response.status, 202); await app.service.task; assert.equal(f.calls.filter(x => x === 'prepare').length, 1);
  assert.equal((await fetch(`${app.url}/api/operations`, { method: 'POST', headers, body: '{' })).status, 400);
});

test('a second server cannot own the same workspace; graceful close releases it for keyless restart', async t => {
  const f = await setup(t);
  const first = await startConsole({ directory: f.directory, port: 0, connect: async () => f.adapter });
  await assert.rejects(startConsole({ directory: f.directory, port: 0, connect: async () => f.adapter }), /locked/);
  const op = await first.service.prepare(f.request()); await first.service.task; assert.equal(op.operations.length, 1);
  await first.close(); f.adapter.project.signingEnabled = false; f.adapter.project.administratorConfigured = false;
  const second = await startConsole({ directory: f.directory, port: 0, connect: async () => f.adapter });
  assert.equal(second.service.projection().operations.length, 1); assert.equal(second.service.projection().project.signingEnabled, false);
  await second.close();
});
