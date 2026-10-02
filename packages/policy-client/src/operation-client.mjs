import { validateDeployment, deploymentProfile } from './deployment.mjs';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prepareNativeTransfer } from '../../local-client/src/prepare-transfer.mjs';
import { verifyTransferProofs } from '../../local-client/src/proofs.mjs';
import { LocalSession, loadWeb3, loadSigner, saveSigner, writeNew, ensure, TOKEN_PROGRAM, PROOF_PROGRAM } from '../../local-client/src/runtime.mjs';
import { SignedInstructionSender } from '../../local-client/src/transaction-sender.mjs';
import { validateOperationTicket } from './operation-ticket.mjs';
import { readPreparedActionEvidence } from './prepared-action.mjs';
import { hash, hexBytes, decimal, le, queryStateDigest, descriptorDigest, validateOperationPlan, readOperationPlan } from './operation-plan.mjs';
import { OperationReader, LocalRpcTransport, buildActionTemplate, buildMerchantDigest, buildLicenseDigest, validateOperation, decodeQuota } from './sdk.mjs';

/** Explicit local operation lifecycle. Observation/recovery never creates a private query. */
export class PolicyOperationClient {
  static async connect({ moduleRoot, endpoint, payerKeyfile, directory, idl, proofCli, deployment, record = async () => {} }) {
    validateDeployment(deployment); const P = deploymentProfile(deployment);
    const web3 = await loadWeb3(moduleRoot), require = createRequire(resolve(moduleRoot, 'package.json'));
    const anchor = require('@anchor-lang/core'), ar = require('@arcium-hq/client'), BN = require('bn.js');
    // The frozen environment is installed by setup_local_js; direct runtime versions also checked here.
    for (const [name, version] of [['@anchor-lang/core', '1.2.0'], ['@arcium-hq/client', '0.15.0'], ['bn.js', '5.2.5']]) {
      let path = resolve(require.resolve(name), '..'), found;
      for (let i = 0; i < 6 && !found; i++, path = resolve(path, '..')) {
        try { const value = JSON.parse(await readFile(resolve(path, 'package.json'))); if (value.name === name) found = value.version; } catch {}
      }
      ensure(found === version, `Expected pinned ${name}@${version}`);
    }
    const payer = await loadSigner(payerKeyfile, web3), session = new LocalSession({ web3, endpoint, payer, directory });
    await session.assertLocalVersions();
    const provider = new anchor.AnchorProvider(session.connection, new anchor.Wallet(payer), { commitment: 'confirmed', preflightCommitment: 'confirmed' });
    const program = new anchor.Program(JSON.parse(await readFile(idl)), provider);
    ensure(program.programId.toBase58() === P.auth, 'Unsupported authorization program');
    const method = program.idl.instructions.find(ix => ix.name === 'runtimePolicyEvaluate');
    ensure(method?.args.at(-1)?.name === 'expectedQueryState', 'Require snapshot-bound query ABI');
    return new PolicyOperationClient({ deployment, session, provider, program, ar, BN, moduleRoot, payerKeyfile, proofCli,
      transport: new SignedInstructionSender(session, record) });
  }
  constructor({ deployment, session, provider, program, ar, BN, moduleRoot, payerKeyfile, proofCli, transport }) {
    Object.assign(this, { deployment, session, provider, program, ar, BN, moduleRoot, payerKeyfile, proofCli, transport });
    this.reader = new OperationReader(new LocalRpcTransport(session.endpoint, { commitment: 'confirmed' }));
    const { PublicKey } = session.web3, P = this.profile = deploymentProfile(deployment);
    this.Q = new PublicKey(P.quota); this.H = new PublicKey(P.policy); this.G = new PublicKey(P.guard);
    this.admission = PublicKey.findProgramAddressSync([Buffer.from('admission')], program.programId)[0];
  }
  async assertDeploymentState() {
    const { PublicKey } = this.session.web3;
    const canonical = PublicKey.findProgramAddressSync([Buffer.from('quota')], this.H)[0];
    ensure(canonical.equals(this.Q), 'Noncanonical deployment state');
    ensure(await this.session.connection.getGenesisHash() === this.deployment.genesisHash, 'Deployment belongs to another ledger');
    const account = await this.session.connection.getAccountInfo(this.Q, 'confirmed');
    ensure(account && account.owner.equals(this.H) && !account.executable, 'Policy state owner mismatch');
    const state = decodeQuota(account.data);
    ensure(state.initialized && state.release.toString('hex') === this.deployment.releaseHashHex && state.schema.toString('hex') === this.deployment.schemaHashHex && state.domain.toString('hex') === this.deployment.domainHashHex, 'Live policy release/schema/key domain mismatch');
    ensure(state.admin === this.session.payer.publicKey.toBase58(), 'Explicit deployment administrator required');
    const mxe = await this.ar.getMXEPublicKey(this.provider, this.program.programId);
    ensure(mxe && Buffer.from(mxe).toString('hex') === this.deployment.mxePublicKeyHex, 'Live MXE encryption domain mismatch');
    return state;
  }
  accounts(offset) {
    const { PublicKey } = this.session.web3, { ar, program } = this;
    return { payer: this.session.payer.publicKey,
      job: PublicKey.findProgramAddressSync([Buffer.from('job'), offset.toArrayLike(Buffer, 'le', 8)], program.programId)[0],
      quota: this.Q, policyProgram: this.H, admission: this.admission, computationAccount: ar.getComputationAccAddress(0, offset),
      clusterAccount: ar.getClusterAccAddress(0), mxeAccount: ar.getMXEAccAddress(program.programId), mempoolAccount: ar.getMempoolAccAddress(0),
      executingPool: ar.getExecutingPoolAccAddress(0), compDefAccount: ar.getCompDefAccAddress(program.programId, Buffer.from(ar.getCompDefAccOffset('runtime_policy_evaluate')).readUInt32LE()) };
  }
  async assertChain(plan) {
    validateOperationPlan(plan);
    ensure(descriptorDigest(plan.descriptor.deployment) === descriptorDigest(this.deployment), 'Operation belongs to another policy deployment');
    ensure(await this.session.connection.getGenesisHash() === plan.genesisHash, 'Operation belongs to a different ledger');
  }
  assertConsumer(plan) {
    const { PublicKey } = this.session.web3, d = plan.descriptor, P = this.profile;
    const product = d.consumerKind === 'merchant' ? le(d.sku) : hexBytes(d.productHex32, 32, 'product');
    const effect = PublicKey.findProgramAddressSync([Buffer.from(d.consumerKind === 'merchant' ? 'purchase' : 'license'),
      new PublicKey(d.owner).toBuffer(), product], new PublicKey(P[d.consumerKind]))[0];
    ensure(effect.toBase58() === d.effect, 'Noncanonical consumer effect address');
  }
  async load(directory) { const plan = await readOperationPlan(resolve(directory, 'operation-plan.json')); await this.assertChain(plan); return plan; }
  async observe(plan) {
    await this.assertChain(plan); this.reader.minimumSlot = Math.max(this.reader.minimumSlot ?? 0, plan.contextSlot);
    return this.reader.observe(plan.descriptor);
  }
  async prepare({ label, directory, provisionedDirectory, amount, consumer }) {
    const P = this.profile; await this.assertDeploymentState();
    ensure(/^[a-z0-9-]+$/.test(label), 'Invalid operation label');
    ensure(consumer?.kind === 'merchant' || consumer?.kind === 'license', 'Unsupported consumer');
    if (consumer.kind === 'merchant') decimal(consumer.sku);
    else { hexBytes(consumer.productHex32, 32, 'product'); decimal(consumer.expirySlot); }
    const genesisHash = await this.session.connection.getGenesisHash();
    const preparedRun = await prepareNativeTransfer({ directory, provisionedDirectory, amount, endpoint: this.session.endpoint,
      moduleRoot: this.moduleRoot, proofCli: this.proofCli, payerKeyfile: this.payerKeyfile });
    await verifyTransferProofs(preparedRun.session, preparedRun.prepared, preparedRun.contextSigners,
      { bufferProgram: P.proofBuffer });
    const { prepared } = preparedRun, { web3, connection, payer } = this.session, { PublicKey, Keypair, TransactionInstruction, SystemProgram } = web3;
    const owner = await loadSigner(resolve(provisionedDirectory, 'source-owner-signer.json'), web3);
    ensure(owner.publicKey.toBase58() === prepared.owner, 'Native source owner mismatch');
    const kind = consumer.kind, consumerProgram = new PublicKey(P[kind]);
    const product = kind === 'merchant' ? le(consumer.sku) : hexBytes(consumer.productHex32, 32, 'product');
    const record = PublicKey.findProgramAddressSync([Buffer.from(kind === 'merchant' ? 'purchase' : 'license'), owner.publicKey.toBuffer(), product], consumerProgram)[0];
    if (!await connection.getAccountInfo(record, 'confirmed')) {
      await this.transport.send(`${label}-initialize-consumer-record`, [new TransactionInstruction({ programId: consumerProgram,
        data: Buffer.concat([Buffer.from([0]), product]), keys: [
          { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: owner.publicKey, isSigner: true, isWritable: false },
          { pubkey: record, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] })], [owner]);
    } else {
      const account = await connection.getAccountInfo(record, 'confirmed');
      // An empty system-owned donation is accepted by the authenticated initializer.
      if (account.owner.equals(SystemProgram.programId) && account.data.length === 0) {
        await this.transport.send(`${label}-initialize-consumer-record`, [new TransactionInstruction({ programId: consumerProgram,
          data: Buffer.concat([Buffer.from([0]), product]), keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: owner.publicKey, isSigner: true, isWritable: false },
            { pubkey: record, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] })], [owner]);
      } else ensure(!account.executable && account.owner.equals(consumerProgram) && account.data.length === (kind === 'merchant' ? 49 : 81) && account.data.every(v => v === 0), 'Consumer record is already issued or unsupported');
    }
    const source = new PublicKey(prepared.source), mint = new PublicKey(prepared.mint), destination = new PublicKey(prepared.destination);
    const addresses = { effect: record.toBuffer(), owner: owner.publicKey.toBuffer(), destination: destination.toBuffer(), mint: mint.toBuffer() };
    const contract = kind === 'merchant' ? buildMerchantDigest({ ...addresses, sku: consumer.sku })
      : buildLicenseDigest({ ...addresses, product, expirySlot: consumer.expirySlot });
    const proofKeys = prepared.proofs.map(proof => new PublicKey(proof.context_address));
    const native = await connection.getMultipleAccountsInfoAndContext([source, ...proofKeys], { commitment: 'confirmed' });
    const [sourceAccount, ...proofAccounts] = native.value;
    ensure(sourceAccount?.owner.toBase58() === TOKEN_PROGRAM && hash(sourceAccount.data).toString('hex') === prepared.source_data_sha256, 'Source changed since native proof preparation');
    ensure(proofAccounts.every(account => account?.owner.toBase58() === PROOF_PROGRAM), 'Expected natively verified contexts');
    const nativeData = Buffer.from(prepared.native_instruction.data, 'hex');
    const template = buildActionTemplate({ source: source.toBuffer(), mint: mint.toBuffer(), destination: destination.toBuffer(), owner: owner.publicKey.toBuffer(),
      sourceData: sourceAccount.data, nativeData, proofKeys: proofKeys.map(key => key.toBuffer()), proofData: proofAccounts.map(account => account.data),
      newSource: Buffer.from(prepared.expected_new_source_ciphertext, 'hex'), commitment: Buffer.from(prepared.expected_commitment, 'hex'),
      quota: this.Q.toBuffer(), consumer: consumerProgram.toBuffer(), consumerContract: contract });
    const permit = Keypair.generate(); await saveSigner(resolve(directory, 'permit-signer.json'), permit);
    await preparedRun.session.createAccount(permit, 712, this.H, [], [], 'create-uninitialized-permit');
    const actionId = new this.BN(randomBytes(8), 'le');
    const action = PublicKey.findProgramAddressSync([Buffer.from('action'), owner.publicKey.toBuffer(), actionId.toArrayLike(Buffer, 'le', 8)], this.program.programId)[0];
    await this.transport.send(`${label}-prepare-immutable-action`, [await this.program.methods.prepareAction(actionId, template, nativeData)
      .accounts({ payer: payer.publicKey, sourceOwner: owner.publicKey, action }).instruction()], [owner]);
    const mxe = await this.ar.getMXEPublicKey(this.provider, this.program.programId); ensure(mxe, 'Runtime-managed MXE key unavailable');
    const secret = this.ar.x25519.utils.randomSecretKey(), publicKey = this.ar.x25519.getPublicKey(secret);
    const cipher = new this.ar.CSplRescueCipher(this.ar.x25519.getSharedSecret(secret, mxe));
    const witness = JSON.parse(await readFile(resolve(directory, 'operation-witness.json')));
    ensure(witness.amount === amount && Buffer.from(witness.commitment).toString('hex') === prepared.expected_commitment, 'Native amount witness mismatch');
    const nonce = randomBytes(16), encrypted = cipher.encrypt([BigInt(amount), this.ar.deserializeLE(Uint8Array.from(witness.opening))], nonce);
    secret.fill(0);
    const quotaRead = await connection.getAccountInfoAndContext(this.Q, { commitment: 'confirmed' });
    ensure(quotaRead.value?.owner.equals(this.H), 'Unsupported quota owner');
    const before = quotaRead.value.data, quota = decodeQuota(before); ensure(quota.admin === payer.publicKey.toBase58(), 'Explicit query administrator signer required');
    const offset = new this.BN(randomBytes(8), 'le'), acc = this.accounts(offset), expiry = String(quotaRead.context.slot + 1800);
    const queued = Buffer.alloc(712); template.copy(queued); before.subarray(0, 8).copy(queued, 8); before.subarray(8, 40).copy(queued, 16);
    le(quota.counter + 1n, 16).copy(queued, 464); le(expiry).copy(queued, 512); before.subarray(257, 353).copy(queued, 616);
    const descriptor = { deployment: this.deployment, profile: P.name, consumerKind: kind, job: acc.job.toBase58(), computation: acc.computationAccount.toBase58(),
      permit: permit.publicKey.toBase58(), owner: owner.publicKey.toBase58(), admin: payer.publicKey.toBase58(), quota: P.quota,
      effect: record.toBase58(), templateHex: queued.toString('hex'), queryStateHashHex: queryStateDigest(before).toString('hex'),
      inputsHashHex: hash(publicKey, nonce, Buffer.from(encrypted[0]), Buffer.from(encrypted[1]), before.subarray(40, 56), quota.ciphertexts, le(quota.counter + 1n, 16), Buffer.from(prepared.expected_commitment, 'hex'), before.subarray(257, 353)).toString('hex'),
      ...(kind === 'merchant' ? { sku: consumer.sku } : { productHex32: consumer.productHex32, licenseExpirySlot: consumer.expirySlot }) };
    const plan = validateOperationPlan({ schema: 1, label, genesisHash, contextSlot: quotaRead.context.slot, descriptor, action: action.toBase58(), quotaSnapshotHex: before.toString('hex'),
      mxePublicKeyHex: Buffer.from(mxe).toString('hex'), query: { offset: offset.toString(), expiry, publicKeyHex: Buffer.from(publicKey).toString('hex'),
        clientNonceHex: nonce.toString('hex'), amountCiphertextHex: Buffer.from(encrypted[0]).toString('hex'), openingCiphertextHex: Buffer.from(encrypted[1]).toString('hex') },
      binding: { nativeDataHex: nativeData.toString('hex'), sourceDataHex: sourceAccount.data.toString('hex'), proofAddresses: proofKeys.map(k => k.toBase58()), proofDataHex: proofAccounts.map(a => a.data.toString('hex')) } });
    const encode = ix => ({ program: ix.programId.toBase58(), data: ix.data.toString('hex'), accounts: ix.keys.map(meta =>
      ({ key: meta.pubkey.toBase58(), signer: meta.isSigner, writable: meta.isWritable })) });
    plan.instructions = { query: encode(await this.queryInstruction(plan)), commit: encode(this.commitInstruction(plan)) };
    ensure(await connection.getGenesisHash() === genesisHash, 'Ledger changed during preparation');
    await writeNew(resolve(directory, 'operation-descriptor.json'), JSON.stringify(descriptor, null, 2));
    await writeNew(resolve(directory, 'operation-plan.json'), JSON.stringify(plan, null, 2));
    return plan;
  }
  async queryInstruction(plan) {
    validateOperationPlan(plan); this.assertConsumer(plan); const { PublicKey } = this.session.web3, { descriptor: d, query: q } = plan;
    const { template: t } = validateOperation(d), offset = new this.BN(q.offset), acc = this.accounts(offset);
    ensure(acc.job.toBase58() === d.job && acc.computationAccount.toBase58() === d.computation, 'Query offset identity mismatch');
    const permit = new PublicKey(d.permit), mint = new PublicKey(t.mint);
    const metadata = PublicKey.findProgramAddressSync([Buffer.from('extra-account-metas'), mint.toBuffer()], this.H)[0];
    return this.program.methods.runtimePolicyEvaluate(offset, [...hexBytes(q.publicKeyHex, 32, 'public key')], new this.BN(hexBytes(q.clientNonceHex, 16, 'nonce'), 'le'),
      [...hexBytes(q.amountCiphertextHex, 32, 'amount ciphertext')], [...hexBytes(q.openingCiphertextHex, 32, 'opening ciphertext')], new this.BN(q.expiry),
      [...hexBytes(d.queryStateHashHex, 32, 'query snapshot')]).accountsPartial({ ...acc, sourceOwner: new PublicKey(d.owner), action: new PublicKey(plan.action), permit,
      permitClaim: PublicKey.findProgramAddressSync([Buffer.from('permit-claim'), permit.toBuffer()], this.program.programId)[0] })
      .remainingAccounts([t.source, t.mint, t.destination, ...plan.binding.proofAddresses, t.consumer, metadata.toBase58()]
        .map(address => ({ pubkey: new PublicKey(address), isSigner: false, isWritable: false }))).instruction();
  }
  async stageQuery(plan, { owner }) {
    await this.assertChain(plan); await this.assertDeploymentState();
    ensure(owner.publicKey.toBase58() === plan.descriptor.owner && this.session.payer.publicKey.toBase58() === plan.descriptor.admin, 'Explicit owner and administrator signers required');
    await readPreparedActionEvidence(plan, this.session.web3, this.session.connection);
    const current = await this.session.connection.getAccountInfo(this.Q, 'confirmed');
    ensure(current?.owner.equals(this.H) && queryStateDigest(current.data).toString('hex') === plan.descriptor.queryStateHashHex, 'Query snapshot changed; explicit fresh preparation required');
    const mxe = await this.ar.getMXEPublicKey(this.provider, this.program.programId);
    ensure(mxe && Buffer.from(mxe).toString('hex') === plan.mxePublicKeyHex, 'Runtime key changed; explicit fresh preparation required');
    return this.transport.stage(`${plan.label}-queue-owner-authorized-query`, [await this.queryInstruction(plan)], [owner],
      { category: 'arcium-queue', role: 'query', descriptorSha256: descriptorDigest(plan.descriptor), minContextSlot: plan.contextSlot });
  }
  commitInstruction(plan) {
    validateOperationPlan(plan); this.assertConsumer(plan); const P = this.profile; const { descriptor: d } = plan, { template: t } = validateOperation(d), { PublicKey, TransactionInstruction } = this.session.web3;
    const consumer = new PublicKey(t.consumer), mint = new PublicKey(t.mint);
    const guard = PublicKey.findProgramAddressSync([Buffer.from('guard')], this.G)[0];
    const consumerPda = PublicKey.findProgramAddressSync([Buffer.from('cyperlink-action'), Buffer.from(t.actionDigest)], consumer)[0];
    const metadata = PublicKey.findProgramAddressSync([Buffer.from('extra-account-metas'), mint.toBuffer()], this.H)[0];
    const addresses = [d.permit, P.quota, guard.toBase58(), P.policy, TOKEN_PROGRAM, t.source, t.mint, t.destination,
      ...plan.binding.proofAddresses, d.owner, metadata.toBase58(), t.consumer, consumerPda.toBase58(), this.G.toBase58(), d.effect];
    const prefix = d.consumerKind === 'merchant' ? [Buffer.from([1]), le(d.sku), Buffer.from([0])]
      : [Buffer.from([2]), hexBytes(d.productHex32, 32, 'product'), le(d.licenseExpirySlot), Buffer.from([0])];
    return new TransactionInstruction({ programId: consumer, data: Buffer.concat([...prefix, hexBytes(plan.binding.nativeDataHex, undefined, 'native instruction')]),
      keys: addresses.map((address, i) => ({ pubkey: new PublicKey(address), isSigner: i === 11, isWritable: [0, 1, 5, 7, 16].includes(i) })) });
  }
  async stageCommit(plan, { owner }) {
    ensure(owner.publicKey.toBase58() === plan.descriptor.owner, 'Explicit owner signer required');
    const observation = await this.observe(plan); ensure(observation.status === 'authorized', `Cannot stage commit while ${observation.status}`);
    return this.transport.stage(`${plan.label}-atomic-paid-entitlement`, [this.commitInstruction(plan)], [owner],
      { category: 'native-settlement', role: 'commit', descriptorSha256: descriptorDigest(plan.descriptor), minContextSlot: observation.slot });
  }
  async submit(plan, ticket) {
    await this.assertChain(plan); this.assertTicket(plan, ticket);
    await validateOperationTicket(plan, (await (await this.transport.durable()).read(ticket)).record, this.session.web3, this.session.connection);
    return this.transport.submit(ticket);
  }
  async recover(plan, ticket) {
    await this.assertChain(plan); this.assertTicket(plan, ticket);
    await validateOperationTicket(plan, (await (await this.transport.durable()).read(ticket)).record, this.session.web3, this.session.connection);
    const delivery = await this.transport.recover(ticket);
    this.reader.minimumSlot = Math.max(this.reader.minimumSlot ?? 0, plan.contextSlot, delivery.result?.slot ?? 0);
    return { delivery, observation: await this.observe(plan) };
  }
  assertTicket(plan, ticket) {
    ensure(ticket.descriptorSha256 === descriptorDigest(plan.descriptor) && ['query', 'commit'].includes(ticket.role), 'Ticket belongs to a different authorized operation');
    ensure(ticket.genesisHash === plan.genesisHash, 'Ticket belongs to a different ledger');
  }
}
