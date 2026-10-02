import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { LocalOperationClient, loadSigner } from '../../packages/local-client/src/index.mjs';
import { validateOperationTicket } from '../../packages/local-client/src/operation-ticket.mjs';
import { descriptorDigest } from '../../packages/local-client/src/operation-plan.mjs';
import { validateOperation } from '../../packages/sdk/src/index.mjs';
import { REPO, ensure, writeNew, loopbackEndpoint } from '../../packages/local-client/src/runtime.mjs';
import { privateJson, sessionDirectory } from './store.mjs';

const execute = promisify(execFile), hash = bytes => createHash('sha256').update(bytes).digest('hex');
export class RealApprovalsAdapter {
  static async connect(bootstrap, directory) {
    ensure(bootstrap.schema === 1 && bootstrap.passed && bootstrap.qualification === 'bootstrap-only-not-purchase', 'Require genuine bootstrap-only manifest');
    ensure(bootstrap.initialAllowance === 100 && bootstrap.loadedPrograms.length === 10, 'Unsupported local bootstrap profile');
    loopbackEndpoint(bootstrap.endpoint);
    directory = await sessionDirectory(directory);
    const adapter = new this({ bootstrap, directory });
    adapter.client = await LocalOperationClient.connect({ ...bootstrap, directory, record: async receipt => {
      await writeNew(resolve(directory, `receipt-${receipt.signature}.json`), JSON.stringify(receipt, null, 2));
    } });
    ensure(await adapter.client.session.connection.getGenesisHash() === bootstrap.genesisHash, 'Bootstrap belongs to a different ledger');
    // Recheck actually loaded ELF bytes before allowing this client to sign. No source change is inferred from a manifest.
    const preparation = JSON.parse(await readFile(bootstrap.preparation));
    ensure(preparation.deployments.length === 10, 'Expected full local program manifest');
    for (const [index, deployment] of preparation.deployments.entries()) {
      const output = resolve(directory, `loaded-${randomUUID()}-${index}.json`);
      await execute('python3', [resolve(REPO, 'scripts/verify_loaded_program.py'), '--program-id', deployment.address,
        '--elf', deployment.elf, '--rpc', bootstrap.endpoint, '--output', output]);
      const report = JSON.parse(await readFile(output));
      ensure(report.matched && report.genesis_hash === bootstrap.genesisHash, 'Loaded program provenance mismatch');
    }
    return adapter;
  }
  constructor(options) { Object.assign(this, options); }
  path(op) { return resolve(this.directory, `operation-${op.id}`); }
  async plan(op) {
    const filename = resolve(this.path(op), 'operation-plan.json'), raw = await readFile(filename);
    ensure(hash(raw) === op.planHash, 'Retained operation plan changed');
    return this.client.load(this.path(op));
  }
  async validateRetained(op) { await this.plan(op); }
  async loadCompletedPreparation(op) {
    try {
      const raw = await readFile(resolve(this.path(op), 'operation-plan.json'));
      const plan = await this.client.load(this.path(op));
      return this.preparedSummary(plan, hash(raw));
    } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async owner(op) { return loadSigner(resolve(this.bootstrap.assetDirectories[op.consumer], 'source-owner-signer.json'), this.client.session.web3); }
  async prepare(op) {
    const consumer = op.consumer === 'merchant' ? { kind: 'merchant', sku: '7' } : { kind: 'license',
      productHex32: hash(Buffer.from('cyperlink-approvals-analytics-license')),
      expirySlot: String(await this.client.session.connection.getSlot('confirmed') + 950) };
    const plan = await this.client.prepare({ label: op.label, directory: this.path(op), provisionedDirectory: this.bootstrap.assetDirectories[op.consumer], amount: op.amount, consumer });
    return this.preparedSummary(plan, hash(await readFile(resolve(this.path(op), 'operation-plan.json'))));
  }
  async preparedSummary(plan, planHash) {
    const { template } = validateOperation(plan.descriptor);
    return { planHash, owner: plan.descriptor.owner,
      source: template.source, destination: template.destination, effect: plan.descriptor.effect,
      terms: { sku: plan.descriptor.sku, productHex32: plan.descriptor.productHex32, licenseExpirySlot: plan.descriptor.licenseExpirySlot,
        queryExpirySlot: plan.query.expiry, policyProfile: plan.descriptor.profile, queryStateHash: plan.descriptor.queryStateHashHex },
      observation: await this.client.observe(plan) };
  }
  async observe(op) { return this.client.observe(await this.plan(op)); }
  async stage(op, role) {
    const plan = await this.plan(op), owner = await this.owner(op);
    return role === 'query' ? this.client.stageQuery(plan, { owner }) : this.client.stageCommit(plan, { owner });
  }
  async submit(op, ticket) { return this.client.submit(await this.plan(op), ticket); }
  async loseResponse(op, ticket) {
    const plan = await this.plan(op), journal = await this.client.transport.durable(), connection = this.client.session.connection;
    const { record } = await journal.read(ticket);
    await validateOperationTicket(plan, record, this.client.session.web3, connection);
    const original = connection.sendRawTransaction.bind(connection);
    connection.sendRawTransaction = async (...args) => { await original(...args); throw Error('TEST ONLY: dropped real RPC send acknowledgement'); };
    try { await journal.send(ticket, { pollAttempts: 0 }); }
    finally { connection.sendRawTransaction = original; }
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
    await execute(process.execPath, [resolve(REPO, 'examples/two-consumers/recover-operation.mjs'),
      '--plan', resolve(this.path(op), 'operation-plan.json'), '--rpc', this.bootstrap.endpoint, '--module-root', this.bootstrap.moduleRoot,
      '--action', submit ? 'submit-ticket' : 'recover-ticket', '--ticket', ticketPath, '--role', ticket.role, '--out', output], { maxBuffer: 1024 * 1024 });
    const result = await privateJson(output);
    ensure(result.passed && result.processId !== process.pid && result.createsNewSignedTransaction === false, 'Expected independent keyless reconciliation');
    return result;
  }
  async recordFailure(op, error) {
    // Restricted diagnostic artifact, never served by HTTP. Avoid proof-cli stdout/stderr or witness data.
    await writeNew(resolve(this.directory, `failure-${randomUUID()}.json`), JSON.stringify({ operationId: op.id,
      name: String(error.name), message: String(error.message).split('\n')[0].slice(0, 500) }));
  }
}
