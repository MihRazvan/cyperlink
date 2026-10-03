#!/usr/bin/env node
/** Additive session integration; the passing license-app remains unchanged. */
import { readFile, realpath } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parse, view } from '../license-app/app.mjs';
import { REPO, ensure } from '../../packages/local-client/src/runtime.mjs';

export async function main(args = process.argv.slice(2)) {
  const { command, options: o } = parse(args);
  const instancePath = resolve(o.instance), operation = resolve(o.operation);
  ensure(instancePath.startsWith(resolve(REPO, '.local') + sep) && await realpath(instancePath) === instancePath, 'Instance must be a nonsymlink local artifact');
  const instance = JSON.parse(await readFile(instancePath));
  const { connectSession } = await import(pathToFileURL(resolve(instance.releaseDirectory, '../../bindings.mjs')));
  const session = await connectSession({ deployment: instance.descriptor, moduleRoot: instance.moduleRoot, endpoint: instance.endpoint,
    directory: `${operation}-approvals`, idl: instance.idl, proofCli: instance.proofCli });
  const signers = { administratorKeyfile: o['admin-keyfile'], ownerKeyfile: o['owner-keyfile'] };
  if (command === 'prepare') {
    const plan = await session.prepare({ label: o.label, directory: operation,
      provisionedDirectory: o['provisioned-directory'] ?? instance.assetDirectories.license, amount: Number(o.amount),
      consumer: { kind: 'license', productHex32: o.product, expirySlot: o['expiry-slot'] } }, signers);
    return { outcome: 'unresolved', status: 'prepared', paymentCommitted: false, product: plan.descriptor.productHex32 };
  }
  const plan = await session.load(operation);
  ensure(plan.descriptor.consumerKind === 'license', 'This application only supports license operations');
  if (command === 'observe') return view(await session.observe(plan));
  if (command === 'recover') {
    const result = await (o.submit === 'yes' ? session.submit(plan, o.role) : session.recover(plan, o.role));
    return { ...view(result.observation, result.delivery), ticket: result.ticket };
  }
  const role = command === 'approve-query' ? 'query' : 'commit';
  const ticket = role === 'query' ? await session.stageQuery(plan, signers) : await session.stageCommit(plan, signers);
  if (o.submit === 'no') return { outcome: 'unresolved', status: 'signed-not-submitted', paymentCommitted: false, ticket };
  const result = await session.submit(plan, role);
  return { ...view(result.observation, result.delivery), ticket };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(result => console.log(JSON.stringify(result))).catch(error => {
    console.error(JSON.stringify({ outcome: 'unresolved', paymentCommitted: false, error: error.message, code: error.code })); process.exitCode = 1;
  });
}
