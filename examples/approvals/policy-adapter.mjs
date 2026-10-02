import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PolicyOperationClient, validateDeployment, validateOperation, canonicalHash, descriptorDigest } from '../../packages/policy-client/src/index.mjs';
import { validateOperationTicket } from '../../packages/policy-client/src/operation-ticket.mjs';
import { REPO, ensure, writeNew, loopbackEndpoint, TOKEN_PROGRAM } from '../../packages/local-client/src/runtime.mjs';
import { RealApprovalsAdapter } from './adapter.mjs';
import { privateJson, sessionDirectory } from './store.mjs';

const execute = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runtimePrograms = ['Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ', 'ArcStnN9zZZVB5WjgPhLHjYpY7Gb29mzb96ySsb1kxgq', 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95'];

/** Public, allowlisted metadata only. No initializer values become observer disclosures. */
export function policyBootstrap(instance, results, release) {
  ensure(instance?.schema === 1 && instance.passed === true, 'Require completed custom policy instance');
  const descriptor = validateDeployment(instance.descriptor), { releaseHashHex, ...body } = release;
  ensure(releaseHashHex === descriptor.releaseHashHex && canonicalHash(body) === releaseHashHex, 'Policy release manifest identity mismatch');
  ensure(release.schemaHashHex === descriptor.schemaHashHex && canonicalHash(release.package?.stateFields) === canonicalHash(descriptor.stateFields), 'Policy release schema mismatch');
  ensure(release.package?.profile === descriptor.profile && /^[a-z][a-z0-9-]{0,47}$/.test(release.package?.name), 'Malformed policy package identity');
  ensure(!instance.policyName || instance.policyName === release.package.name, 'Policy name differs from authenticated package manifest');
  ensure(results?.passed === true && results.phase === 'ready' && results.genesisHash === descriptor.genesisHash && results.releaseHashHex === descriptor.releaseHashHex, 'Custom deployment is incomplete or belongs to another release');
  ensure(canonicalHash(results.descriptor) === canonicalHash(descriptor), 'Instance differs from completed deployment descriptor');
  const expected = new Set([descriptor.programs.auth, descriptor.programs.policy, descriptor.programs.guard, descriptor.programs.merchant,
    descriptor.programs.license, descriptor.programs.proofBuffer, TOKEN_PROGRAM, ...runtimePrograms]);
  ensure(expected.size === 10 && results.loadedPrograms?.length === 10, 'Require ten custom deployment program reports');
  for (const report of results.loadedPrograms) {
    ensure(expected.delete(report.program) && report.matched === true && report.genesis_hash === descriptor.genesisHash,
      'Loaded program report set differs from custom deployment');
    ensure(typeof report.local_elf_path === 'string' && /^[a-f0-9]{64}$/.test(report.elf_sha256) && report.loaded_elf_sha256 === report.elf_sha256, 'Malformed custom program provenance');
  }
  ensure(expected.size === 0, 'Missing custom deployment program');
  loopbackEndpoint(instance.endpoint);
  return { ...instance, genesisHash: descriptor.genesisHash, bootstrapDirectory: dirname(resolve(instance.results)),
    loadedPrograms: results.loadedPrograms, policyName: release.package.name,
    policy: { name: release.package.name, release: descriptor.releaseHashHex, schema: descriptor.schemaHashHex,
      state: descriptor.quota, auth: descriptor.programs.auth, domain: descriptor.domainHashHex } };
}

/** Real custom SDK adapter. The legacy adapter continues handling historical v0 sessions. */
export class PolicyApprovalsAdapter extends RealApprovalsAdapter {
  static async connect(instance, directory) {
    const results = await privateJson(instance.results), release = JSON.parse(await readFile(resolve(instance.releaseDirectory, 'release.json')));
    const bootstrap = policyBootstrap(instance, results, release);
    directory = await sessionDirectory(directory);
    // Recheck retained circuit files against the authenticated release before opening a signing client.
    ensure(Object.keys(release.artifacts).length === 8, 'Require both complete custom circuit artifact sets');
    for (const [name, artifact] of Object.entries(release.artifacts)) {
      ensure(/^runtime_policy_(init|evaluate)\.(arcis|idarc|hash|weight)$/.test(name), 'Unsupported policy artifact');
      const bytes = await readFile(resolve(instance.releaseDirectory, 'circuits', name));
      ensure(hash(bytes) === artifact.sha256 && bytes.length === artifact.bytes, 'Policy artifact differs from authenticated release');
    }
    for (const [index, deployment] of bootstrap.loadedPrograms.entries()) {
      const bytes = await readFile(deployment.local_elf_path);
      ensure(hash(bytes) === deployment.elf_sha256, 'Retained enforcement build changed');
      const output = resolve(directory, `loaded-${randomUUID()}-${index}.json`);
      await execute('python3', [resolve(REPO, 'scripts/verify_loaded_program.py'), '--program-id', deployment.program,
        '--elf', deployment.local_elf_path, '--rpc', bootstrap.endpoint, '--output', output]);
      const report = JSON.parse(await readFile(output));
      ensure(report.matched && report.genesis_hash === bootstrap.genesisHash && report.elf_sha256 === deployment.elf_sha256, 'Loaded custom program provenance mismatch');
    }
    const adapter = new this({ bootstrap, directory });
    adapter.client = await PolicyOperationClient.connect({ ...instance, deployment: instance.descriptor, directory,
      record: receipt => writeNew(resolve(directory, `receipt-${receipt.signature}.json`), JSON.stringify(receipt, null, 2)) });
    await adapter.client.assertDeploymentState();
    bootstrap.policy.mxe = adapter.client.ar.getMXEAccAddress(adapter.client.program.programId).toBase58();
    return adapter;
  }
  async preparedSummary(plan, planHash) {
    const { template } = validateOperation(plan.descriptor);
    return { planHash, owner: plan.descriptor.owner, source: template.source, destination: template.destination, effect: plan.descriptor.effect,
      terms: { sku: plan.descriptor.sku, productHex32: plan.descriptor.productHex32, licenseExpirySlot: plan.descriptor.licenseExpirySlot,
        queryExpirySlot: plan.query.expiry, policyProfile: plan.descriptor.profile, queryStateHash: plan.descriptor.queryStateHashHex,
        policyName: this.bootstrap.policy.name, policyRelease: plan.descriptor.deployment.releaseHashHex,
        policySchema: plan.descriptor.deployment.schemaHashHex, policyMxe: this.bootstrap.policy.mxe },
      observation: await this.client.observe(plan) };
  }
  async loseResponse(op, ticket) {
    const plan = await this.plan(op), journal = await this.client.transport.durable(), connection = this.client.session.connection;
    await validateOperationTicket(plan, (await journal.read(ticket)).record, this.client.session.web3, connection);
    const original = connection.sendRawTransaction.bind(connection);
    connection.sendRawTransaction = async (...args) => { await original(...args); throw Error('TEST ONLY: dropped real RPC send acknowledgement'); };
    try { await journal.send(ticket, { pollAttempts: 0 }); } finally { connection.sendRawTransaction = original; }
  }
  async discoverTicket(op, role) {
    const plan = await this.plan(op), journal = await this.client.transport.durable(), candidates = [];
    for (const name of await readdir(journal.directory)) {
      if (!name.endsWith('.signed.json')) continue;
      const record = await privateJson(resolve(journal.directory, name));
      if (record.role !== role || record.descriptorSha256 !== descriptorDigest(plan.descriptor)) continue;
      const ticket = { schemaVersion: 1, journalDirectory: journal.directory, genesisHash: record.genesisHash, signature: record.signature,
        wireSha256: record.wireSha256, role, descriptorSha256: record.descriptorSha256 };
      await journal.read(ticket); candidates.push(ticket);
    }
    ensure(candidates.length <= 1, 'Multiple retained transactions require explicit inspection');
    return candidates[0];
  }
  async recover(op, ticket, submit) {
    await this.plan(op);
    const ticketPath = resolve(this.directory, `worker-${randomUUID()}-ticket.json`), output = resolve(this.directory, `worker-${randomUUID()}-result.json`);
    await writeNew(ticketPath, JSON.stringify(ticket));
    await execute(process.execPath, [resolve(REPO, 'packages/policy-client/recover-operation.mjs'),
      '--plan', resolve(this.path(op), 'operation-plan.json'), '--rpc', this.bootstrap.endpoint, '--module-root', this.bootstrap.moduleRoot,
      '--action', submit ? 'submit-ticket' : 'recover-ticket', '--ticket', ticketPath, '--role', ticket.role, '--out', output], { maxBuffer: 1024 * 1024 });
    const result = await privateJson(output);
    ensure(result.passed && result.processId !== process.pid && result.createsNewSignedTransaction === false, 'Expected independent custom policy keyless reconciliation');
    return result;
  }
}
