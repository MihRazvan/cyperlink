/** Qualification-only preload. Kill an actual process at durable SDK boundaries.
 * No signatures, verified contexts, permits or receipts are fabricated.
 */
import { DurableTransactionSender } from '../../packages/local-client/src/durable-transaction.mjs';
import { PolicyOperationClient } from '../../packages/policy-client/src/operation-client.mjs';
import { openSync, writeSync, fsyncSync, closeSync } from 'node:fs';
const point = process.env.CYPERLINK_TEST_CRASH_POINT;
const role = process.env.CYPERLINK_TEST_CRASH_ROLE;
const marker = process.env.CYPERLINK_TEST_CRASH_MARKER;
function crash(ticket) {
  const fd = openSync(marker, 'wx', 0o600);
  writeSync(fd, JSON.stringify({ point, role, pid: process.pid, ticket })); fsyncSync(fd); closeSync(fd);
  process.kill(process.pid, 'SIGKILL');
}
if (point === 'before-wire' || point === 'after-wire') {
  const original = DurableTransactionSender.prototype.prepare;
  DurableTransactionSender.prototype.prepare = async function (options) {
    if (options.role === role && point === 'before-wire') crash(null);
    const ticket = await original.call(this, options);
    if (options.role === role && point === 'after-wire') crash(ticket);
    return ticket;
  };
} else if (point === 'after-simulation') {
  const method = role === 'query' ? 'stageQuery' : 'stageCommit', original = PolicyOperationClient.prototype[method];
  PolicyOperationClient.prototype[method] = async function (...args) { const ticket = await original.apply(this, args); crash(ticket); };
} else throw Error('Unsupported test crash point');
