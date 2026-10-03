import { fetchRpc, isRpcUnavailable } from '../../sdk/src/rpc-availability.mjs';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPrivateRun, loadWeb3, loadSigner, ensure, loopbackEndpoint } from '../../local-client/src/runtime.mjs';
import { DurableTransactionSender } from '../../local-client/src/durable-transaction.mjs';
import { PolicyOperationClient } from './operation-client.mjs';
import { validateDeployment } from './deployment.mjs';
import { descriptorDigest, validateOperationPlan, readOperationPlan } from './operation-plan.mjs';
import { openApprovalStore } from './approval-store.mjs';
import { OperationReader, LocalRpcTransport } from './sdk.mjs';

/** Opt-in local session. Opening, observation and exact-byte recovery never load keys.
 * Each descriptor/role reserves one signing attempt. A crashed attempt is not consent
 * to replace its transaction, even if no signed record can be recovered.
 */
export class PolicySession {
  static async connect({ deployment, moduleRoot, endpoint, directory, idl, proofCli }) {
    validateDeployment(deployment);
    endpoint = loopbackEndpoint(endpoint);
    const web3 = await loadWeb3(moduleRoot);
    const connection = new web3.Connection(endpoint, { commitment: 'confirmed', disableRetryOnRateLimit: true,
      fetch: (url, options) => { ensure(loopbackEndpoint(url) === endpoint, 'Unexpected session RPC endpoint'); return fetchRpc(globalThis.fetch, url, { ...options, redirect: 'error' }); } });
    ensure((await connection.getVersion())['solana-core'] === '4.3.0', 'Expected pinned local Agave 4.3.0');
    ensure(await connection.getGenesisHash() === deployment.genesisHash, 'Deployment belongs to another ledger');
    const store = await openApprovalStore({ directory, genesisHash: deployment.genesisHash, endpoint, deploymentHash: descriptorDigest(deployment) });
    return new PolicySession({ deployment, moduleRoot, endpoint, directory: store.directory, idl, proofCli, web3, connection, store });
  }
  constructor(options) {
    Object.assign(this, options);
    this.reader = new OperationReader(new LocalRpcTransport(this.endpoint, { commitment: 'confirmed', fetch: (url, options) => fetchRpc(globalThis.fetch, url, options) }));
  }
  async assertPlan(plan) {
    validateOperationPlan(plan);
    ensure(descriptorDigest(plan.descriptor.deployment) === descriptorDigest(this.deployment), 'Operation belongs to another policy deployment');
    ensure(await this.connection.getGenesisHash() === plan.genesisHash, 'Operation belongs to another ledger');
  }
  async load(directory) {
    const plan = await readOperationPlan(resolve(directory, 'operation-plan.json')); await this.assertPlan(plan); return plan;
  }
  async observe(plan) {
    await this.assertPlan(plan); this.reader.minimumSlot = Math.max(this.reader.minimumSlot ?? 0, plan.contextSlot);
    return this.reader.observe(plan.descriptor);
  }
  async signers(options, plan) {
    ensure(options?.ownerKeyfile && options?.administratorKeyfile, 'Explicit ownerKeyfile and administratorKeyfile required');
    const owner = await loadSigner(options.ownerKeyfile, this.web3), administrator = await loadSigner(options.administratorKeyfile, this.web3);
    if (plan) ensure(owner.publicKey.toBase58() === plan.descriptor.owner && administrator.publicKey.toBase58() === plan.descriptor.admin,
      'Explicit owner or administrator differs from retained operation');
    return { owner, administrator };
  }
  async signingClient(directory, signers) {
    return PolicyOperationClient.connect({ deployment: this.deployment, moduleRoot: this.moduleRoot, endpoint: this.endpoint,
      payerKeyfile: signers.administratorKeyfile, directory, idl: this.idl, proofCli: this.proofCli });
  }
  async prepare(options, signers) {
    await this.signers(signers);
    const directory = await createPrivateRun(resolve(this.directory, `prepare-${randomUUID()}`));
    const client = await this.signingClient(directory, signers);
    return client.prepare({ ...options, ownerKeyfile: signers.ownerKeyfile });
  }
  async stage(plan, role, signers) {
    await this.assertPlan(plan);
    const { owner } = await this.signers(signers, plan);
    // The create-only intent wins before any operation signing. Concurrent/restarted
    // callers can only rediscover the winning attempt, never create a second one.
    const intent = await this.store.begin(plan, role);
    if (!intent.created) return this.discoverApproval(plan, role);
    const client = await this.signingClient(intent.signingDirectory, signers);
    const ticket = role === 'query' ? await client.stageQuery(plan, { owner }) : await client.stageCommit(plan, { owner });
    await this.store.saveTicket(plan, role, ticket);
    return this.discoverApproval(plan, role);
  }
  stageQuery(plan, signers) { return this.stage(plan, 'query', signers); }
  stageCommit(plan, signers) { return this.stage(plan, 'commit', signers); }
  async discoverApproval(plan, role) {
    await this.assertPlan(plan);
    return this.store.discover(plan, role, { web3: this.web3, connection: this.connection });
  }
  async reconcile(plan, role, submit) {
    const ticket = await this.discoverApproval(plan, role);
    const sender = await DurableTransactionSender.open({ web3: this.web3, connection: this.connection, endpoint: this.endpoint, directory: ticket.journalDirectory });
    let delivery = await sender.recover(ticket);
    // Only explicit submit resumes an interrupted simulation, with the original
    // signatures/blockhash. Read-only recovery never simulates or broadcasts.
    if (submit && delivery.status === 'simulation-required') {
      const saved = await sender.read(ticket);
      const simulation = await this.connection.simulateTransaction(saved.tx, { sigVerify: true, commitment: 'confirmed', minContextSlot: saved.record.minContextSlot });
      try { await sender.recordSimulation(ticket, simulation); }
      catch (error) { if (error.code !== 'EEXIST') throw error; } // concurrent exact-ticket resumption: read the winning record
    }
    if (submit && !delivery.availability.length) delivery = await sender.send(ticket);
    this.reader.minimumSlot = Math.max(this.reader.minimumSlot ?? 0, plan.contextSlot, delivery.observationSlot);
    // Expose public delivery metadata; keep signed wire, witnesses and private keys
    // in the local journal. RPC receipt/effect are separate facts.
    const result = { status: delivery.status, signature: ticket.signature, wireSha256: ticket.wireSha256, role,
      attempts: delivery.attempts, canBroadcast: delivery.canBroadcast, observationSlot: this.reader.minimumSlot, availability: delivery.availability,
      ...(delivery.receipt ? { receipt: { slot: delivery.receipt.slot, error: delivery.receipt.meta.err,
        landedCU: delivery.receipt.meta.computeUnitsConsumed, feeLamports: delivery.receipt.meta.fee } } : {}) };
    let observation;
    try { observation = await this.observe(plan); }
    catch (error) {
      if (!isRpcUnavailable(error, 'getMultipleAccounts')) throw error;
      observation = { status: 'unresolved', reason: 'Account RPC unavailable', minContextSlot: this.reader.minimumSlot,
        availability: { method: error.method, category: error.category, status: error.status, code: error.code } };
    }
    if (observation.status !== 'unresolved') await sender.recordContext(ticket, observation.slot);
    return { ticket, delivery: result, observation };
  }
  recover(plan, role) { return this.reconcile(plan, role, false); }
  submit(plan, role) { return this.reconcile(plan, role, true); }
}
