import test from 'node:test';
import assert from 'node:assert/strict';
import { inspect } from 'node:util';
import { RpcUnavailableError, isRpcUnavailable, fetchRpc } from '../src/rpc-availability.mjs';

const options = (method = 'getTransaction') => ({ method: 'POST', body: JSON.stringify({
  jsonrpc: '2.0', id: 1, method, params: ['synthetic-signed-wire-secret'],
}) });
const url = 'http://127.0.0.1:8899/private-url-secret';
const fail = error => async () => { throw error; };

test('recognized Node fetch network causes and aborts carry exact method metadata', async () => {
  for (const code of ['ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'EHOSTUNREACH', 'ENETUNREACH',
    'ENETDOWN', 'EAI_AGAIN', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT',
    'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_SOCKET']) {
    const original = new TypeError('fetch failed', { cause: Object.assign(new Error('network'), { code }) });
    await assert.rejects(fetchRpc(fail(original), url, options()), error => {
      assert(isRpcUnavailable(error, 'getTransaction'));
      assert.equal(isRpcUnavailable(error, 'getSignatureStatuses'), false);
      assert.equal(error.category, 'network'); assert.equal(error.code, code);
      assert.equal(error.status, undefined); assert.equal(error.cause, undefined);
      return true;
    });
  }
  for (const name of ['AbortError', 'TimeoutError']) {
    await assert.rejects(fetchRpc(fail(new DOMException('aborted', name)), url, options('getSignatureStatuses')),
      error => isRpcUnavailable(error, 'getSignatureStatuses') && error.code === name);
  }
});

test('only explicitly transient HTTP statuses are availability errors', async () => {
  for (const status of [408, 429, 500, 502, 503, 504]) {
    const response = { status, json() { assert.fail('availability boundary must not decode responses'); } };
    await assert.rejects(fetchRpc(async () => response, url, options()), error => {
      assert(isRpcUnavailable(error, 'getTransaction'));
      assert.equal(error.category, 'http'); assert.equal(error.status, status);
      assert.equal(error.code, undefined); return true;
    });
  }
  for (const status of [200, 204, 301, 400, 401, 403, 404, 409, 422, 501, 505]) {
    const response = { status, ok: status < 300 };
    assert.equal(await fetchRpc(async () => response, url, options()), response);
  }
});

test('programmer, integrity and unrecognized network failures propagate unchanged', async () => {
  for (const original of [new TypeError('programmer bug'), new SyntaxError('bad JSON'),
    new Error('malformed transaction'), new Error('fetch failed'),
    Object.assign(new Error('ordinary error'), { code: 'ECONNRESET' }),
    new TypeError('invalid request', { cause: { code: 'ERR_INVALID_URL' } }),
    { name: 'TimeoutError' }, null]) {
    await assert.rejects(fetchRpc(fail(original), url, options()), error => {
      assert.equal(error, original); assert.equal(isRpcUnavailable(error), false); return true;
    });
  }
  const parserError = new SyntaxError('invalid response JSON');
  const response = await fetchRpc(async () => ({ status: 200, json: fail(parserError) }), url, options());
  await assert.rejects(response.json(), error => error === parserError && !isRpcUnavailable(error));
  const malformed = { error: { code: -32000 }, result: { slot: 'bad' } };
  const decoded = await fetchRpc(async () => ({ status: 200, json: async () => malformed }), url, options());
  assert.equal(await decoded.json(), malformed, 'RPC errors and malformed result shapes belong to caller validation');
});

test('availability errors never retain signed request bytes, URL, response or original error details', async () => {
  const original = new TypeError('private-original-message', { cause: {
    code: 'ECONNRESET', key: 'private-account-key', request: options(), url,
  } });
  await assert.rejects(fetchRpc(fail(original), url, options('sendTransaction')), error => {
    assert(isRpcUnavailable(error, 'sendTransaction'));
    const rendered = `${inspect(error, { depth: 10 })} ${JSON.stringify(error)}`;
    for (const secret of ['synthetic-signed-wire-secret', 'private-url-secret', 'private-original-message', 'private-account-key']) {
      assert.equal(rendered.includes(secret), false);
    }
    assert.deepEqual(Object.keys(error).sort(), ['category', 'code', 'method', 'name']);
    return true;
  });
});

test('unknown request methods cannot be mistaken for receipt methods; request is forwarded unchanged', async () => {
  for (const body of [undefined, '{invalid', 'null', '[]', '[{"method":"getTransaction"}]',
    '{"method":1}', '{"method":"getTransaction\\nsecret"}', '{"method":"http://secret"}']) {
    const request = { body };
    await assert.rejects(fetchRpc(async (actualUrl, actualOptions) => {
      assert.equal(actualUrl, url); assert.equal(actualOptions, request); return { status: 503 };
    }, url, request), error => {
      assert(isRpcUnavailable(error)); assert.equal(error.method, null);
      assert.equal(isRpcUnavailable(error, 'getTransaction'), false); return true;
    });
  }
  assert.equal(isRpcUnavailable({ name: 'RpcUnavailableError', method: 'getTransaction' }), false);
  assert.equal(isRpcUnavailable(new Error('RPC unavailable')), false);
  assert.throws(() => new RpcUnavailableError({ method: 'getTransaction', category: 'network', code: 'secret' }), TypeError);
});
