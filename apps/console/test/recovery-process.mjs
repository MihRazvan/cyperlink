/** Qualification worker only. Keyless Console with explicit local RPC outage control. */
import { startConsole } from '../server.mjs';
import { readFile } from 'node:fs/promises';
let fault = 'none', endpoint, signature;
const events = [], original = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  if (String(url) !== endpoint) return original(url, options);
  const request = JSON.parse(options.body);
  const blocked = fault !== 'none' && request.method === 'getTransaction' && request.params[0] === signature ||
    fault === 'accounts' && request.method === 'getMultipleAccounts';
  events.push({ method: request.method, blocked, fault, processId: process.pid });
  if (blocked) return new Response('TEST ONLY: local RPC transport unavailable', { status: 503 });
  if (['sendTransaction', 'simulateTransaction'].includes(request.method)) throw Error('Read-only qualification must never submit or simulate');
  return original(url, options);
};
let app;
process.on('message', async message => {
  try {
    if (message.command === 'start') {
      endpoint = JSON.parse(await readFile(message.instancePath)).endpoint; signature = message.signature;
      if (new URL(endpoint).hostname !== '127.0.0.1') throw Error('Local runtime required');
      app = await startConsole({ instancePath: message.instancePath, directory: message.directory, port: 0 });
      process.send({ id: message.id, url: app.url, processId: process.pid });
    } else if (message.command === 'fault') { fault = message.mode; process.send({ id: message.id, fault }); }
    else if (message.command === 'events') process.send({ id: message.id, events });
    else if (message.command === 'close') { await app?.close(); process.send({ id: message.id }); process.disconnect(); }
  } catch (error) { process.send({ id: message.id, error: error.message }); }
});
