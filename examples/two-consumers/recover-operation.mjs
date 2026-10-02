#!/usr/bin/env node
/** A new process may observe/recover or explicitly submit an existing signed ticket.
 * This worker never accepts a signer, prepares proofs, or allocates another operation.
 */
import { constants } from 'node:fs';
import { open, realpath, lstat } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { loopbackEndpoint, loadWeb3, REPO, ensure, writeNew } from '../../packages/local-client/src/runtime.mjs';
import { validateOperationPlan, descriptorDigest } from '../../packages/local-client/src/operation-plan.mjs';
import { validateOperationTicket } from '../../packages/local-client/src/operation-ticket.mjs';
import { DurableTransactionSender } from '../../packages/local-client/src/durable-transaction.mjs';
import { OperationReader, LocalRpcTransport } from '../../packages/sdk/src/index.mjs';

const ACTIONS = new Set(['observe', 'recover-ticket', 'submit-ticket']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function summarizeDeliveryDiagnostics(result) {
  const pick = (value, fields) => Object.fromEntries(fields.filter(key => value?.[key] !== undefined).map(key => [key, value[key]]));
  const broadcasts = (result.broadcasts ?? []).slice(0, 10).map(item => ({
    ...pick(item, ['attempt', 'rpcMaxRetries', 'startedAt']), response: item.response ? {
      ...pick(item.response, ['signature', 'wireSha256', 'attempt', 'completedAt', 'outcome', 'returnedSignature']),
      ...(item.response.error ? { error: { ...pick(item.response.error, ['name', 'code']), message: String(item.response.error.message).slice(0, 16384) } } : {}),
    } : null,
  }));
  return { retryPolicy: pick(result.retryPolicy, ['maxBroadcasts', 'rpcMaxRetries']), broadcasts,
    ...(result.lastSendError !== undefined ? { lastSendError: String(result.lastSendError).slice(0, 16384) } : {}) };
}

export function assertTicketBinding(plan, ticket, record, role) {
  ensure(['query', 'commit'].includes(role), 'Explicit query or commit role required');
  ensure(ticket.genesisHash === plan.genesisHash && record.genesisHash === plan.genesisHash, 'Ticket genesis differs from retained plan');
  ensure(record.role === role && record.descriptorSha256 === descriptorDigest(plan.descriptor), 'Signed ticket role or descriptor differs from retained plan');
}

export function parseArguments(args) {
  const supported = new Set(['plan', 'rpc', 'module-root', 'action', 'ticket', 'role', 'out', 'expect-status']);
  const values = {};
  for (let i = 0; i < args.length; i += 2) {
    const name = args[i]?.replace(/^--/, '');
    ensure(args[i]?.startsWith('--') && supported.has(name) && args[i + 1] && !args[i + 1].startsWith('--'), 'Expected supported --name value arguments');
    ensure(!(name in values), `Duplicate option: ${name}`);
    values[name] = args[i + 1];
  }
  ensure(values.plan && values.rpc && values['module-root'] && values.action && values.out, 'Require --plan --rpc --module-root --action --out');
  ensure(ACTIONS.has(values.action), 'Action must be observe, recover-ticket, or submit-ticket');
  ensure(values.action === 'observe' ? !values.ticket : Boolean(values.ticket), 'Ticket is required only for recover-ticket or submit-ticket');
  ensure(values.action === 'observe' ? !values.role : ['query', 'commit'].includes(values.role), 'Ticket actions require --role query or commit');
  return { plan: values.plan, endpoint: loopbackEndpoint(values.rpc), moduleRoot: values['module-root'], action: values.action,
    ticket: values.ticket, role: values.role, output: values.out, expectedStatus: values['expect-status'] };
}

export async function readRetainedJson(path) {
  const absolute = resolve(path);
  ensure(absolute.startsWith(resolve(REPO, '.local') + sep), 'Retained artifacts must remain beneath repository .local');
  ensure(await realpath(absolute) === absolute, 'Retained artifact path may not traverse symlinks');
  const stream = await open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await stream.stat();
    ensure(stat.isFile() && stat.uid === process.getuid() && (stat.mode & 0o077) === 0, 'Retained artifact must be a private regular file owned by this user');
    ensure(stat.size > 0 && stat.size <= 2 * 1024 * 1024, 'Invalid retained artifact size');
    const bytes = await stream.readFile();
    return { value: JSON.parse(bytes), sha256: hash(bytes), bytes: bytes.length, path: absolute };
  } finally { await stream.close(); }
}

/** Adapter is supplied by the local operation client in main, and by host tests. */
export async function runRecovery(options, adapter) {
  ensure(ACTIONS.has(options.action), 'Unsupported recovery action');
  const output = resolve(options.output);
  ensure(output.startsWith(resolve(REPO, '.local') + sep) && await realpath(dirname(output)) === dirname(output), 'Output requires existing nonsymlink repository .local directory');
  try { await lstat(output); throw Error('Recovery output already exists'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const retained = await readRetainedJson(options.plan), plan = retained.value;
  ensure(plan.schema === 1 && typeof plan.genesisHash === 'string' && plan.descriptor, 'Invalid persisted operation plan');
  const genesisHash = await adapter.genesisHash();
  ensure(genesisHash === plan.genesisHash, 'Retained operation belongs to a different validator genesis');
  const identity = Object.fromEntries(['job', 'computation', 'permit', 'owner', 'quota', 'effect'].map(key => [key, plan.descriptor[key]]));
  const result = { schema: 1, processId: process.pid, action: options.action,
    evidenceLevel: 'separate-process-local-operation-reconciliation', genesisHash,
    retainedPlan: { sha256: retained.sha256, bytes: retained.bytes }, identity,
    generatesKeysProofsOrOperationIdentity: false, createsNewSignedTransaction: false };
  await adapter.validatePlan(plan);
  if (options.action !== 'observe') {
    ensure(options.ticket, 'Recovery requires retained signed ticket');
    const ticket = await readRetainedJson(options.ticket);
    result.retainedTicket = { sha256: ticket.sha256, bytes: ticket.bytes };
    // The adapter returns an explicitly public delivery summary, never signed wire/key data.
    result.delivery = options.action === 'submit-ticket'
      ? await adapter.submitTicket(plan, ticket.value, options.ticket)
      : await adapter.recoverTicket(plan, ticket.value, options.ticket);
  }
  result.observation = await adapter.observe(plan);
  if (options.expectedStatus) ensure(result.observation.status === options.expectedStatus,
    `Expected ${options.expectedStatus}, observed ${result.observation.status}`);
  ensure((await adapter.genesisHash()) === genesisHash, 'Validator genesis changed during recovery');
  result.passed = true;
  await writeNew(output, JSON.stringify(result, null, 2));
  return result;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const adapter = await createLocalAdapter(options);
  const result = await runRecovery(options, adapter);
  console.log(JSON.stringify(result));
}

async function createLocalAdapter(options) {
  const endpoint = loopbackEndpoint(options.endpoint), web3 = await loadWeb3(options.moduleRoot);
  const connection = new web3.Connection(endpoint, { commitment: 'confirmed', disableRetryOnRateLimit: true,
    fetch: (url, request) => { ensure(loopbackEndpoint(url) === endpoint, 'Unexpected recovery RPC endpoint');
      return fetch(url, { ...request, redirect: 'error' }); } });
  const reader = new OperationReader(new LocalRpcTransport(endpoint, { commitment: 'confirmed' }));
  async function delivery(plan, ticket, submit) {
    ensure(['query', 'commit'].includes(options.role), 'Explicit query or commit role required');
    ensure(ticket.genesisHash === plan.genesisHash, 'Ticket genesis differs from retained plan');
    const sender = await DurableTransactionSender.open({ web3, connection, endpoint, directory: ticket.journalDirectory });
    const { record } = await sender.read(ticket);
    assertTicketBinding(plan, ticket, record, options.role);
    const semanticBinding = await validateOperationTicket(plan, record, web3, connection);
    const result = submit ? await sender.send(ticket) : await sender.recover(ticket);
    reader.minimumSlot = Math.max(reader.minimumSlot ?? 0, record.minContextSlot, result.receipt?.slot ?? 0);
    return { status: result.status, canBroadcast: result.canBroadcast, attempts: result.attempts,
      ...summarizeDeliveryDiagnostics(result),
      signature: result.signature, semanticBinding, role: record.role, descriptorSha256: record.descriptorSha256, wireSha256: record.wireSha256,
      ...(result.receipt ? { receipt: { slot: result.receipt.slot, error: result.receipt.meta.err,
        landedCU: result.receipt.meta.computeUnitsConsumed, feeLamports: result.receipt.meta.fee } } : {}) };
  }
  return { genesisHash: () => connection.getGenesisHash(), validatePlan: plan => {
      validateOperationPlan(plan); reader.minimumSlot = Math.max(reader.minimumSlot ?? 0, plan.contextSlot);
    },
    observe: plan => reader.observe(plan.descriptor),
    recoverTicket: (plan, ticket) => delivery(plan, ticket, false),
    submitTicket: (plan, ticket) => delivery(plan, ticket, true) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(JSON.stringify({ passed: false, error: error.message })); process.exitCode = 1; });
}
