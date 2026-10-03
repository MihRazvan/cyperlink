#!/usr/bin/env node
import { readFile, realpath, lstat } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createPrivateRun, loadWeb3, loadSigner, writeNew } from '../../packages/local-client/src/runtime.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '../..');
const LOCAL = resolve(ROOT, '.local');
const COMMANDS = ['prepare', 'approve-query', 'observe', 'approve-payment', 'recover'];
const OPTIONS = new Set(['instance', 'operation', 'admin-keyfile', 'owner-keyfile', 'amount', 'product', 'expiry-slot', 'label', 'role', 'submit', 'provisioned-directory']);
function check(ok, message) { if (!ok) throw Error(message); }
export function parse(args) {
  const [command, ...rest] = args;
  check(COMMANDS.includes(command), `Command must be ${COMMANDS.join(', ')}`);
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    const key = rest[i]?.slice(2), value = rest[i + 1];
    check(rest[i]?.startsWith('--') && OPTIONS.has(key) && value && !value.startsWith('--') && !(key in options), 'Expected unique supported --option value pairs');
    options[key] = value;
  }
  check(options.instance && options.operation, 'Require --instance and --operation');
  check(options.submit === undefined || ['yes', 'no'].includes(options.submit), '--submit must be yes or no');
  if (['prepare', 'approve-query', 'approve-payment'].includes(command)) {
    check(options['admin-keyfile'] && options['owner-keyfile'], 'Explicit --admin-keyfile and --owner-keyfile required');
  } else check(!options['admin-keyfile'] && !options['owner-keyfile'], 'Observation and recovery do not accept signers');
  if (command === 'prepare') {
    check(/^[1-9][0-9]*$/.test(options.amount ?? '') && Number.isSafeInteger(Number(options.amount)) && BigInt(options.amount) < (1n << 48n), 'Amount must be a positive exact integer below 2^48');
    check(/^[a-f0-9]{64}$/.test(options.product ?? ''), 'Product must be 64 lowercase hexadecimal characters');
    check(/^(0|[1-9][0-9]*)$/.test(options['expiry-slot'] ?? '') && BigInt(options['expiry-slot']) < (1n << 64n), 'Expiry must be a canonical decimal u64 slot');
    check(/^[a-z0-9-]+$/.test(options.label ?? ''), 'Require a lowercase --label');
  } else for (const key of ['amount', 'product', 'expiry-slot', 'label', 'provisioned-directory']) check(!options[key], `--${key} is only valid for prepare`);
  if (command === 'recover') check(['query', 'commit'].includes(options.role), 'Recovery requires --role query or commit');
  else check(!options.role, '--role is only valid for recover');
  if (['prepare', 'observe'].includes(command)) check(!options.submit, '--submit is only valid for approvals or recovery');
  return { command, options };
}
async function localPath(path, exists = true) {
  const absolute = resolve(path);
  check(absolute.startsWith(LOCAL + sep), 'Runtime paths and signing keys must be beneath repository .local');
  if (exists) check(await realpath(absolute) === absolute, 'Runtime paths may not traverse symlinks');
  return absolute;
}
async function json(path) { return JSON.parse(await readFile(path, 'utf8')); }
async function present(path) { try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
export function view(observation, delivery) {
  const outcome = observation.status === 'committed' ? 'committed'
    : observation.status === 'authorized' ? 'authorized'
    : observation.status === 'denied' ? 'rejected'
    : ['stale', 'expired', 'invalidated', 'cancelled'].includes(observation.status) ? 'action-required' : 'unresolved';
  return { outcome,
    paymentCommitted: observation.status === 'committed', status: observation.status,
    ...(delivery ? { deliveryStatus: delivery.status, signature: delivery.signature, canBroadcast: delivery.canBroadcast } : {}),
    observation };
}
function runWorker(args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [resolve(ROOT, 'packages/policy-client/recover-operation.mjs'), ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'inherit'] });
    let output = ''; child.stdout.on('data', data => { output += data; });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolvePromise(JSON.parse(output)) : reject(Error(`Keyless worker exited ${code}; retained files remain unchanged`)));
  });
}
export async function main(args = process.argv.slice(2)) {
  const { command, options: o } = parse(args);
  const instance = await json(await localPath(o.instance));
  const operation = await localPath(o.operation, command !== 'prepare');
  // A new session avoids create-only file collisions after a process restart.
  const session = await createPrivateRun(resolve(LOCAL, 'license-app-invocations', randomUUID()));
  if (command === 'observe' || command === 'recover') {
    const retained = await json(await localPath(resolve(operation, 'operation-plan.json')));
    check(retained.descriptor?.consumerKind === 'license', 'This application only observes license operations');
    check(retained.descriptor.deployment?.releaseHashHex === instance.descriptor.releaseHashHex
      && retained.descriptor.deployment?.domainHashHex === instance.descriptor.domainHashHex,
    'Retained operation differs from the selected license deployment');
    const args = ['--plan', resolve(operation, 'operation-plan.json'), '--rpc', instance.endpoint, '--module-root', instance.moduleRoot,
      '--action', command === 'observe' ? 'observe' : o.submit === 'yes' ? 'submit-ticket' : 'recover-ticket', '--out', resolve(session, 'reconciliation.json')];
    if (command === 'recover') args.push('--role', o.role, '--ticket', resolve(operation, `${o.role}-ticket.json`));
    const result = await runWorker(args);
    return { ...view(result.observation, result.delivery), report: resolve(session, 'reconciliation.json') };
  }
  const adminPath = await localPath(o['admin-keyfile']);
  const ownerPath = await localPath(o['owner-keyfile']);
  const { connect } = await import(pathToFileURL(resolve(HERE, '.cyperlink/bindings.mjs')).href);
  const client = await connect({ deployment: instance.descriptor, moduleRoot: instance.moduleRoot, endpoint: instance.endpoint,
    payerKeyfile: adminPath, directory: session, idl: instance.idl, proofCli: instance.proofCli });
  const owner = await loadSigner(ownerPath, await loadWeb3(instance.moduleRoot));
  if (command === 'prepare') {
    const provisionedDirectory = await localPath(o['provisioned-directory'] ?? instance.assetDirectories.license);
    check(ownerPath === await localPath(resolve(provisionedDirectory, 'source-owner-signer.json')), 'Preparation requires explicit approval of the provisioned source owner signer');
    const plan = await client.prepare({ label: o.label, directory: operation, provisionedDirectory, amount: Number(o.amount),
      consumer: { kind: 'license', productHex32: o.product, expirySlot: o['expiry-slot'] } });
    return { outcome: 'unresolved', status: 'prepared', paymentCommitted: false, operation, product: plan.descriptor.productHex32, expirySlot: plan.descriptor.licenseExpirySlot };
  }
  const plan = await client.load(operation);
  check(plan.descriptor.consumerKind === 'license', 'This application only approves license operations');
  check(owner.publicKey.toBase58() === plan.descriptor.owner, 'Explicit owner signer differs from retained operation');
  const admin = await loadSigner(adminPath, await loadWeb3(instance.moduleRoot));
  check(admin.publicKey.toBase58() === plan.descriptor.admin, 'Explicit administrator signer differs from retained operation');
  const role = command === 'approve-query' ? 'query' : 'commit';
  const ticketPath = resolve(operation, `${role}-ticket.json`), intentPath = resolve(operation, `${role}-approval-intent.json`);
  const retainedTicket = await present(ticketPath);
  let ticket;
  if (retainedTicket) ticket = await json(await localPath(ticketPath));
  else {
    check(!await present(intentPath), 'An interrupted approval intent exists without its ticket. Inspect the retained SDK journal; do not restage this operation');
    if (role === 'commit') check((await client.observe(plan)).status === 'authorized', 'A current authorized observation is required for payment approval');
    await writeNew(intentPath, JSON.stringify({ role, session, owner: plan.descriptor.owner, created: new Date().toISOString() }));
    ticket = role === 'query' ? await client.stageQuery(plan, { owner }) : await client.stageCommit(plan, { owner });
    await writeNew(ticketPath, JSON.stringify(ticket));
  }
  if (o.submit === 'no') return { outcome: 'unresolved', status: 'signed-not-submitted', paymentCommitted: false, role, signature: ticket.signature, ticket: ticketPath };
  if (retainedTicket) {
    // Existing tickets belong to their original journal, not this fresh signing
    // session. The documented keyless worker opens that retained journal.
    const report = resolve(session, 'reconciliation.json');
    const result = await runWorker(['--plan', resolve(operation, 'operation-plan.json'),
      '--rpc', instance.endpoint, '--module-root', instance.moduleRoot,
      '--action', 'submit-ticket', '--role', role, '--ticket', ticketPath, '--out', report]);
    return { ...view(result.observation, result.delivery), signature: ticket.signature, ticket: ticketPath, report };
  }
  await client.submit(plan, ticket);
  return { ...view(await client.observe(plan)), signature: ticket.signature, ticket: ticketPath };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(JSON.stringify({ outcome: 'unresolved', paymentCommitted: false, error: error.message })); process.exitCode = 1; });
}
