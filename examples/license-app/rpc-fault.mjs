/** Qualification-only Node preload. Never imported by the application itself. */
import { readFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)), '.local');
const path = resolve(process.env.CYPERLINK_TEST_RPC_FAULT_FILE ?? '');
if (!path.startsWith(root + sep)) throw Error('Fault configuration must be local');
const config = JSON.parse(await readFile(path));
if (!['lost-ack', 'unavailable-receipt'].includes(config.mode)) throw Error('Unsupported test fault');
if (!resolve(config.log).startsWith(root + sep)) throw Error('Fault log must be local');
const endpoint = new URL(config.endpoint);
if (!['127.0.0.1', 'localhost'].includes(endpoint.hostname)) throw Error('Test requires loopback');
const original = globalThis.fetch;
let sent = false;
globalThis.fetch = async (url, options) => {
  if (String(url) !== config.endpoint) return original(url, options);
  const request = JSON.parse(options.body);
  if (request.method === 'getTransaction' && request.params[0] === config.signature
      && (sent || config.mode === 'unavailable-receipt')) {
    await appendFile(config.log, JSON.stringify({ fault: 'receipt-unavailable', processId: process.pid }) + '\n', { mode: 0o600 });
    throw Error('TEST ONLY: receipt RPC unavailable; delivery remains unresolved');
  }
  const response = await original(url, options);
  if (config.mode === 'lost-ack' && request.method === 'sendTransaction') {
    const wireSha256 = createHash('sha256').update(Buffer.from(request.params[0], 'base64')).digest('hex');
    if (wireSha256 === config.wireSha256) {
      const result = await response.clone().json();
      if (result.result !== config.signature) throw Error('Fault target did not return the expected signature');
      sent = true;
      await appendFile(config.log, JSON.stringify({ fault: 'actual-send-response-lost', processId: process.pid,
        signature: result.result, wireSha256 }) + '\n', { mode: 0o600 });
      throw Error('TEST ONLY: actual send response lost');
    }
  }
  return response;
};
