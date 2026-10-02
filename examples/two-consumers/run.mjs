#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { provision } from '../../packages/local-client/src/provision.mjs';
import { LocalOperationClient } from '../../packages/local-client/src/operation-client.mjs';
import * as local from '../../packages/local-client/src/runtime.mjs';
import { DemoTransport, sleep } from './transport.mjs';
import { sha256, u64, actionTemplate, consumerDigest, parseQuota, assertSettlementEffect } from './operation.mjs';
import { OperationReader, LocalRpcTransport, validateOperation } from '../../packages/sdk/src/index.mjs';
const execute = promisify(execFile);
const AUTH = '5bgSoi3WbUndQNhWrkxJoURjkRd28BxxucZozwGR9AQQ';

export async function run(options) {
  local.ensure(['conflict', 'compatible'].includes(options.scenario), 'Choose conflict or compatible');
  const endpoint = local.loopbackEndpoint(options.endpoint ?? 'http://127.0.0.1:8899');
  const preparation = JSON.parse(await readFile(options.preparation, 'utf8'));
  local.ensure(preparation.profile === 'provisioned161' && local.loopbackEndpoint(preparation.rpc) === endpoint,
    'Require matching provisioned161 preparation and endpoint');
  const directory = await local.createPrivateRun(options.directory);
  const evidence = { schema_version: 1, scenario: options.scenario, passed: false,
    evidence_level: 'real-local-validator-and-two-node-runtime', rpc: endpoint,
    scope: 'synthetic same-mint assets, one quota/MXE, administrator co-signed queries',
    transactions: [], callbacks: [], checks: [], operations: [],
    observer_disclosures: { initial_allowance: 100, purchase_amounts: options.scenario === 'conflict' ? [60, 60, 60] : [40, 40],
      note: 'Setup and requested amounts are disclosed to the test observer. Remaining allowance is inferred from committed purchases, not decrypted from MXE state.' },
    limitations: ['No public-network execution or production claim', 'Internal reference consumers, no external integration commitment',
      'CU/fees measure validator transactions; wall-clock callback latency is separate from distributed runtime resource costs, which are not measured'] };
  const save = () => writeFile(resolve(directory, 'results.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  await save();
  try {
    const web3 = await local.loadWeb3(options.moduleRoot), require = createRequire(resolve(options.moduleRoot, 'package.json'));
    for (const [name, version] of [['@anchor-lang/core', '1.2.0'], ['@arcium-hq/client', '0.15.0'], ['bn.js', '5.2.5']]) {
      // Some packages restrict package.json exports; resolve via their installed root.
      let manifest;
      try { manifest = require(`${name}/package.json`); }
      catch { const entry = require.resolve(name); let path = resolve(entry, '..');
        for (let i = 0; i < 5 && !manifest; i++, path = resolve(path, '..')) {
          try { const candidate = JSON.parse(await readFile(resolve(path, 'package.json'), 'utf8')); if (candidate.name === name) manifest = candidate; } catch {}
        }
      }
      local.ensure(manifest?.version === version, `Expected pinned ${name}@${version}`);
    }
    const anchor = require('@anchor-lang/core'), ar = require('@arcium-hq/client'), BN = require('bn.js');
    const { PublicKey, Keypair, SystemProgram, TransactionInstruction } = web3;
    const payer = await local.loadSigner(options.payerKeyfile, web3);
    const transactionsDir = await local.createPrivateRun(resolve(directory, 'transactions'));
    const session = new local.LocalSession({ web3, endpoint, payer, directory: transactionsDir });
    evidence.validator = await session.assertLocalVersions(); evidence.genesis_hash = await session.connection.getGenesisHash();
    const connection = session.connection;
    // Actual loaded bytes are checked before any client account is provisioned.
    evidence.loaded_programs = [];
    for (const [i, deployment] of preparation.deployments.entries()) {
      const output = resolve(directory, `loaded-program-${i}.json`);
      await execute('python3', [resolve(local.REPO, 'scripts/verify_loaded_program.py'), '--program-id', deployment.address,
        '--elf', deployment.elf, '--rpc', endpoint, '--output', output]);
      evidence.loaded_programs.push(JSON.parse(await readFile(output, 'utf8')));
    }
    const requiredPrograms = [AUTH, ...[81, 82, 83, 84, 89].map(n => new PublicKey(Buffer.alloc(32, n)).toBase58()), local.TOKEN_PROGRAM];
    local.ensure(requiredPrograms.every(key => evidence.loaded_programs.some(item => item.program === key && item.matched)), 'Missing required loaded-program verification');
    const idlBytes = await readFile(options.idl), idl = JSON.parse(idlBytes);
    evidence.idl_sha256 = sha256(idlBytes).toString('hex');
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), { commitment: 'confirmed', preflightCommitment: 'confirmed' });
    anchor.setProvider(provider);
    const program = new anchor.Program(idl, provider), arcium = ar.getArciumProgram(provider);
    assert.equal(program.programId.toBase58(), AUTH);
    const H = new PublicKey(Buffer.alloc(32, 82)), G = new PublicKey(Buffer.alloc(32, 81));
    const Q = PublicKey.findProgramAddressSync([Buffer.from('quota')], H)[0];
    assert.equal(Q.toBase58(), 'qc9zZrjjzConf2TmLvkCkwZNsCrWfNwGEzjLCvtbsE2');
    local.ensure(!await connection.getAccountInfo(Q), 'Scenario requires a fresh ledger with no quota; never reset/reuse a completed ledger');
    const admission = PublicKey.findProgramAddressSync([Buffer.from('admission')], program.programId)[0];
    const transport = new DemoTransport(session, async result => { evidence.transactions.push(result); await save(); });
    const operationReader = new OperationReader(new LocalRpcTransport(endpoint, { commitment: 'confirmed' }));
    const client = new LocalOperationClient({ session, provider, program, ar, BN, moduleRoot: options.moduleRoot,
      payerKeyfile: options.payerKeyfile, proofCli: options.proofCli, transport });
    async function prefundPda(label, key) {
      if (options.prefundPdas !== 'true') return;
      local.ensure(!await connection.getAccountInfo(key), 'Prefunding test requires a previously absent PDA');
      await transport.send(`${label}-prefund-system-pda`, [SystemProgram.transfer({ fromPubkey: payer.publicKey,
        toPubkey: key, lamports: await connection.getMinimumBalanceForRentExemption(0) })], [], { category: 'adversarial-prefunding-setup' });
      const account = await connection.getAccountInfo(key, 'confirmed');
      local.ensure(account.owner.equals(SystemProgram.programId) && !account.executable && account.data.length === 0, 'Invalid prefunded-PDA setup');
      evidence.checks.push({ label: `${label}-prefunded-empty-system-account`, address: key.toBase58(), lamports: account.lamports }); await save();
    }
    const bn = bytes => new BN(ar.deserializeLE(bytes).toString());
    const def = name => ar.getCompDefAccAddress(program.programId, Buffer.from(ar.getCompDefAccOffset(name)).readUInt32LE());
    const accounts = (name, offset) => ({ payer: payer.publicKey,
      job: PublicKey.findProgramAddressSync([Buffer.from('job'), offset.toArrayLike(Buffer, 'le', 8)], program.programId)[0],
      quota: Q, policyProgram: H, admission, computationAccount: ar.getComputationAccAddress(0, offset),
      clusterAccount: ar.getClusterAccAddress(0), mxeAccount: ar.getMXEAccAddress(program.programId),
      mempoolAccount: ar.getMempoolAccAddress(0), executingPool: ar.getExecutingPoolAccAddress(0), compDefAccount: def(name) });
    async function committedCallback(acc, expectedStatus, name, queuedAt) {
      let job;
      for (let i = 0; i < 600; i++) {
        job = await program.account.job.fetch(acc.job); if (job.status !== 0) break; await sleep(250);
      }
      assert.equal(job.status, expectedStatus, `Unexpected job status ${acc.job}`);
      assert(job.computation.equals(acc.computationAccount));
      for (let attempt = 0; attempt < 100; attempt++) {
        for (const entry of await connection.getSignaturesForAddress(acc.job, { limit: 30 }, 'confirmed')) {
          if (entry.err) continue;
          const tx = await connection.getTransaction(entry.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
          if (!tx || tx.meta.err || !tx.meta.logMessages?.some(line => line.includes(`Instruction: ${name}`))) continue;
          const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
          const all = Array.from({ length: keys.length }, (_, i) => keys.get(i));
          if (!all.some(key => key.equals(acc.job)) || !all.some(key => key.equals(acc.computationAccount))) continue;
          const instruction = tx.transaction.message.compiledInstructions.find(ix => keys.get(ix.programIdIndex).equals(program.programId));
          local.ensure(instruction, 'Missing actual callback instruction');
          const decoded = program.coder.instruction.decode(Buffer.from(instruction.data));
          const output = decoded?.data?.output?.success?.[0]; local.ensure(output, 'Callback did not contain signed successful runtime output');
          const result = { label: name, job: acc.job.toBase58(), computation: acc.computationAccount.toBase58(),
            signature: entry.signature, output, status: job.status, elapsedFromQueueMs: Date.now() - queuedAt,
            slot: tx.slot, landedCU: tx.meta.computeUnitsConsumed, feeLamports: tx.meta.fee, transaction: tx };
          evidence.callbacks.push(result); await save(); return result;
        }
        await sleep(250);
      }
      throw Error('No successful callback for exact job/computation; do not accept failed duplicate helper signatures');
    }
    async function initDef(name, method, expectedHash) {
      const bytes = await readFile(resolve(options.circuits, `${name}.arcis`));
      assert.equal(sha256(bytes).toString('hex'), expectedHash, 'Unqualified runtime circuit artifact');
      if (!await connection.getAccountInfo(def(name))) {
        const mxe = await arcium.account.mxeAccount.fetch(ar.getMXEAccAddress(program.programId));
        const ix = await program.methods[method]().accounts({ payer: payer.publicKey, mxeAccount: ar.getMXEAccAddress(program.programId),
          compDefAccount: def(name), addressLookupTable: ar.getLookupTableAddress(program.programId, mxe.lutOffsetSlot) }).instruction();
        await transport.send(`${name}-definition`, [ix], [], { category: 'arcium-definition' });
      }
      const before = new Set((await connection.getSignaturesForAddress(def(name), { limit: 1000 }, 'confirmed')).map(item => item.signature));
      await ar.uploadCircuit(provider, name, program.programId, bytes, true, 500, { skipPreflight: false, commitment: 'confirmed' });
      // SDK-upload transactions use its own sender; preserve actual receipts separately.
      for (const item of await connection.getSignaturesForAddress(def(name), { limit: 1000 }, 'confirmed')) {
        if (before.has(item.signature)) continue;
        const tx = await connection.getTransaction(item.signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        if (tx) evidence.transactions.push({ label: `${name}-upload`, category: 'arcium-circuit-upload', signature: item.signature,
          slot: tx.slot, landedCU: tx.meta.computeUnitsConsumed, feeLamports: tx.meta.fee, error: tx.meta.err, transaction: tx });
      }
      await save();
    }
    const programData = PublicKey.findProgramAddressSync([program.programId.toBuffer()], new PublicKey('BPFLoaderUpgradeab1e11111111111111111111111'))[0];
    await prefundPda('quota', Q);
    await transport.send('provision-quota', [await program.methods.provisionQuota().accounts({ payer: payer.publicKey,
      programData, quota: Q, policyProgram: H, admission, systemProgram: SystemProgram.programId }).instruction()]);
    await initDef('runtime_budget_init', 'initRuntimeBudgetInitCompDef', '6eb1f33a3e21bb7b5ce0da19d14e69b3311e1051d904043c575240421886b6a0');
    await initDef('runtime_budget_bound', 'initRuntimeBudgetBoundCompDef', 'eaad70f272e3d1f9405a92755cbb7140bb066bf048bf81752c7c51c74a7ac085');
    let mxe;
    for (let i = 0; i < 240 && !mxe; i++) { mxe = await ar.getMXEPublicKey(provider, program.programId); if (!mxe) await sleep(250); }
    local.ensure(mxe, 'Runtime-managed MXE key unavailable');
    const secret = ar.x25519.utils.randomSecretKey(), publicKey = Array.from(ar.x25519.getPublicKey(secret));
    const cipher = new ar.CSplRescueCipher(ar.x25519.getSharedSecret(secret, mxe));
    evidence.runtime_mxe_public_key_hex = Buffer.from(mxe).toString('hex');
    const offset = new BN(randomBytes(8), 'le'), nonce = randomBytes(16), encrypted = cipher.encrypt([100n], nonce)[0];
    const initAccounts = accounts('runtime_budget_init', offset), initAt = Date.now();
    {
      await transport.send('initialize-encrypted-allowance', [await program.methods.runtimeBudgetInit(offset, publicKey, bn(nonce), Array.from(encrypted)).accountsPartial(initAccounts).instruction()], [], { category: 'arcium-queue' });
      await committedCallback(initAccounts, 1, 'RuntimeBudgetInitCallback', initAt);
    }
    const quotaBytes = async () => (await connection.getAccountInfo(Q, 'confirmed')).data;
    assert.equal(parseQuota(await quotaBytes()).version, '0');
    const common = { endpoint, moduleRoot: options.moduleRoot, proofCli: options.proofCli, payerKeyfile: options.payerKeyfile };
    const assetA = await provision({ ...common, directory: resolve(directory, 'asset-a') });
    const assetB = await provision({ ...common, directory: resolve(directory, 'asset-b'), existingMint: assetA.accounts.mint.address });
    assert.equal(assetA.accounts.mint.address, assetB.accounts.mint.address, 'Consumers must compete in same native currency');
    // Exact canonical routing initialization, signed and permissionless to fund.
    const mint = new PublicKey(assetA.accounts.mint.address);
    const metadata = PublicKey.findProgramAddressSync([Buffer.from('extra-account-metas'), mint.toBuffer()], H)[0];
    await prefundPda('hook-metadata', metadata);
    await transport.send('initialize-hook-metadata', [new TransactionInstruction({ programId: H, data: Buffer.from([7]), keys: [
      { pubkey: mint, isSigner: false, isWritable: false }, { pubkey: metadata, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] })]);
    const owners = { a: await local.loadSigner(resolve(directory, 'asset-a/source-owner-signer.json'), web3),
      b: await local.loadSigner(resolve(directory, 'asset-b/source-owner-signer.json'), web3) };
    async function recoverInProcess(op, action, ticket, label, expectedStatus) {
      const ticketPath = resolve(directory, `recovery-${label}-ticket.json`), output = resolve(directory, `recovery-${label}.json`);
      if (ticket) await local.writeNew(ticketPath, JSON.stringify(ticket));
      const args = [resolve(local.REPO, 'examples/two-consumers/recover-operation.mjs'), '--plan', resolve(op.directory, 'operation-plan.json'),
        '--rpc', endpoint, '--module-root', options.moduleRoot, '--action', action, '--out', output];
      if (ticket) args.push('--ticket', ticketPath, '--role', ticket.role);
      if (expectedStatus) args.push('--expect-status', expectedStatus);
      await execute(process.execPath, args, { maxBuffer: 1024 * 1024 });
      const result = JSON.parse(await readFile(output)); assert(result.passed && result.processId !== process.pid);
      evidence.recoveries ??= []; evidence.recoveries.push({ label, ...result }); await save();
      return result;
    }
    async function prepareOperation(label, who, amount, sku = '7') {
      const owner = owners[who], kind = who === 'a' ? 'merchant' : 'license';
      const consumer = new PublicKey(Buffer.alloc(32, who === 'a' ? 83 : 84));
      const product = kind === 'merchant' ? u64(sku) : sha256(Buffer.from('cyperlink-demo-license'));
      const expiry = String((await connection.getSlot('confirmed')) + 950);
      const record = PublicKey.findProgramAddressSync([Buffer.from(kind === 'merchant' ? 'purchase' : 'license'), owner.publicKey.toBuffer(), product], consumer)[0];
      if (!await connection.getAccountInfo(record)) await prefundPda(`${label}-consumer-record`, record);
      const operationDirectory = resolve(directory, `operation-${label}`);
      const plan = await client.prepare({ label, directory: operationDirectory, provisionedDirectory: resolve(directory, `asset-${who}`), amount,
        consumer: kind === 'merchant' ? { kind, sku } : { kind, productHex32: product.toString('hex'), expirySlot: expiry } });
      // Reopen the persisted plan before signing; never infer expected intent from returned chain state.
      const reopened = await client.load(operationDirectory); assert.deepEqual(reopened, plan);
      const descriptor = plan.descriptor, { template: t } = validateOperation(descriptor);
      return { label, kind, amount, owner, source: new PublicKey(t.source), destination: new PublicKey(t.destination),
        proofKeys: plan.binding.proofAddresses.map(key => new PublicKey(key)), consumer, product, expiry: Number(expiry), record,
        contract: Buffer.from(t.actionDigest), permit: new PublicKey(descriptor.permit), nativeData: Buffer.from(plan.binding.nativeDataHex, 'hex'),
        job: new PublicKey(descriptor.job), descriptor, plan, directory: operationDirectory };
    }
    async function prepareAndAdmit(label, who, amount, expectedStatus = 1, onQueued = async () => {}) {
      const op = await prepareOperation(label, who, amount), { plan, descriptor } = op;
      const before = await quotaBytes(), started = Date.now();
      const ticket = await client.stageQuery(plan, { owner: op.owner });
      if (who === 'b') {
        // Fault injection drops a real send response after journaling/broadcast. It does not fabricate a receipt.
        const original = connection.sendRawTransaction.bind(connection);
        connection.sendRawTransaction = async (...args) => { await original(...args); throw Error('TEST ONLY: dropped real RPC send response'); };
        try { await (await transport.durable()).send(ticket, { pollAttempts: 0 }); }
        finally { connection.sendRawTransaction = original; }
        await recoverInProcess(op, 'recover-ticket', ticket, `${label}-lost-response`);
      }
      await recoverInProcess(op, 'submit-ticket', ticket, `${label}-submit-retained-query`);
      const recovered = await client.recover(plan, ticket); assert(recovered.delivery.result && recovered.delivery.result.error === null);
      evidence.transactions.push(recovered.delivery.result); await save();
      await onQueued();
      const acc = { job: op.job, computationAccount: new PublicKey(descriptor.computation) };
      const callback = await committedCallback(acc, expectedStatus, 'RuntimeBudgetBoundCallback', started);
      assert.equal(callback.output.field1, expectedStatus === 1, 'Unexpected disclosed policy decision');
      assert(Buffer.from(callback.output.field0).equals(Buffer.from(validateOperation(descriptor).template.amountCommitment)), 'Native commitment mismatch in callback');
      const after = await quotaBytes(); assert(before.subarray(0, 88).equals(after.subarray(0, 88)), 'Admission consumed quota');
      await recoverInProcess(op, 'observe', null, `${label}-after-callback`, expectedStatus === 1 ? 'authorized' : 'denied');
      const observation = await client.observe(plan); assert.equal(observation.status, expectedStatus === 1 ? 'authorized' : 'denied');
      evidence.checks.push({ label: `${label}-sdk-observation`, observation });
      evidence.operations.push({ label, kind: op.kind, requestedAmountObserverDisclosure: amount, status: expectedStatus, source: op.source.toBase58(), destination: op.destination.toBase58(),
        permit: op.permit.toBase58(), job: op.job.toBase58(), consumer: op.consumer.toBase58(), record: op.record.toBase58(), quotaVersionAtAdmission: parseQuota(before).version });
      await save(); return op;
    }
    async function rejectDelayedQuery(op, ticket) {
      const keys = [Q, op.permit, op.job, new PublicKey(op.descriptor.computation), PublicKey.findProgramAddressSync([Buffer.from('permit-claim'), op.permit.toBuffer()], program.programId)[0]];
      const read = async () => {
        const response = await connection.getMultipleAccountsInfoAndContext(keys, { commitment: 'confirmed' });
        return { slot: response.context.slot, accounts: response.value.map((account, i) => account ? { address: keys[i].toBase58(), owner: account.owner.toBase58(),
          lamports: account.lamports, executable: account.executable, dataBase64: account.data.toString('base64') } : null) };
      };
      const before = await read(); assert(before.accounts.slice(2).every(account => account === null));
      // Preflight must be bypassed to retain an actual failing transaction; original signed bytes are unchanged.
      const original = connection.sendRawTransaction.bind(connection);
      connection.sendRawTransaction = (wire, config) => original(wire, { ...config, skipPreflight: true });
      let receipt;
      try { receipt = await (await transport.durable()).send(ticket); }
      finally { connection.sendRawTransaction = original; }
      assert.equal(receipt.status, 'failed'); assert.equal(receipt.receipt.meta.err.InstructionError[1].Custom, 6004);
      const after = await read(); assert.deepEqual(after.accounts, before.accounts);
      const result = transport.result(receipt, ticket); evidence.transactions.push(result);
      evidence.querySnapshotRejection = { actualCustomError: 6004, signature: result.signature, before, after,
        trackedAddresses: keys.map(key => key.toBase58()), operationLabel: op.label, descriptor: op.descriptor,
        exactSignedWireReused: true, jobPermitClaimAndComputationAbsent: true, quotaAndPermitUnchanged: true };
      await recoverInProcess(op, 'recover-ticket', ticket, 'delayed-query-rejected', 'unobserved');
      await save();
    }
    function consume(op, fail = false) {
      const guardPda = PublicKey.findProgramAddressSync([Buffer.from('guard')], G)[0];
      const consumerPda = PublicKey.findProgramAddressSync([Buffer.from('cyperlink-action'), op.contract], op.consumer)[0];
      const keys = [op.permit, Q, guardPda, H, new PublicKey(local.TOKEN_PROGRAM), op.source, mint, op.destination,
        ...op.proofKeys, op.owner.publicKey, metadata, op.consumer, consumerPda, G, op.record];
      const prefix = op.kind === 'merchant' ? [Buffer.from([1]), op.product, Buffer.from([Number(fail)])]
        : [Buffer.from([2]), op.product, u64(op.expiry), Buffer.from([Number(fail)])];
      return new TransactionInstruction({ programId: op.consumer, data: Buffer.concat([...prefix, op.nativeData]),
        keys: keys.map((pubkey, i) => ({ pubkey, isSigner: i === 11, isWritable: [0, 1, 5, 7, 16].includes(i) })) });
    }
    async function snapshotAccounts(keys, label) {
      const response = await connection.getMultipleAccountsInfoAndContext(keys, { commitment: 'confirmed' });
      local.ensure(response.value.every(Boolean), 'Snapshot contains a missing account');
      evidence.accountSnapshots ??= [];
      evidence.accountSnapshots.push({ label, context: response.context, commitment: 'confirmed',
        accounts: keys.map((key, i) => ({ address: key.toBase58(), owner: response.value[i].owner.toBase58(),
          executable: response.value[i].executable, lamports: response.value[i].lamports,
          dataBase64: response.value[i].data.toString('base64') })) });
      await save();
      return keys.map((key, i) => ({ address: key.toBase58(), data: response.value[i].data }));
    }
    async function state(op, label) {
      return snapshotAccounts([op.source, op.destination, op.permit, Q, op.record], label);
    }
    async function reject(op, label, code, fail = false) {
      const before = await state(op, `${label}-before`);
      const tx = await transport.send(label, [consume(op, fail)], [op.owner], { expectedError: code, category: 'adversarial-native-settlement' });
      assert.deepEqual(await state(op, `${label}-after`), before, 'Rejected transaction mutated native/application state');
      if (fail) local.ensure(tx.transaction.meta.logMessages.some(line => line.includes('ConfidentialTransferInstruction::Transfer')), 'Forced failure occurred before native transfer');
      evidence.checks.push({ label, actualCustomError: code, allFiveAccountDataUnchanged: true }); await save();
      const observation = await operationReader.observe(op.descriptor);
      assert.equal(observation.status, code === 803 ? 'stale' : code === 1001 ? 'committed' : 'authorized');
      evidence.checks.push({ label: `${label}-sdk-observation`, observation }); await save();
    }
    async function commit(op) {
      const before = await state(op, `${op.label}-commit-before`);
      const ticket = await client.stageCommit(op.plan, { owner: op.owner });
      await recoverInProcess(op, 'submit-ticket', ticket, `${op.label}-submit-retained-commit`, 'committed');
      const recovered = await client.recover(op.plan, ticket); assert.equal(recovered.observation.status, 'committed');
      evidence.transactions.push(recovered.delivery.result);
      await recoverInProcess(op, 'recover-ticket', ticket, `${op.label}-after-commit`, 'committed');
      const after = await state(op, `${op.label}-commit-after`);
      assertSettlementEffect(before[3].data, after[3].data, after[2].data, after[4].data, op.kind);
      assert(before[0].data.equals(after[0].data) === false && before[1].data.equals(after[1].data) === false, 'Native source and destination must both change');
      const observation = await operationReader.observe(op.descriptor); assert.equal(observation.status, 'committed');
      evidence.checks.push({ label: `${op.label}-sdk-paid-entitlement`, observation });
      evidence.checks.push({ label: `${op.label}-native-payment-and-entitlement-atomic`, changedAccounts: after.map(item => item.address) }); await save();
    }
    async function bindingFailures(op) {
      // Prove the original operation can settle now, before introducing any mutation.
      const latest = await connection.getLatestBlockhash('confirmed');
      const honest = new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: payer.publicKey,
        recentBlockhash: latest.blockhash, instructions: [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1300000 }), consume(op)] }).compileToV0Message());
      honest.sign([payer, op.owner]);
      const simulation = await connection.simulateTransaction(honest, { sigVerify: true, commitment: 'confirmed' });
      assert.equal(simulation.value.err, null, `Honest operation must be executable before binding attacks: ${JSON.stringify(simulation.value)}`);
      evidence.checks.push({ label: 'honest-commit-before-binding-attacks', evidence_level: 'signature-verified-local-validator-simulation',
        simulatedCU: simulation.value.unitsConsumed, logs: simulation.value.logs });
      async function changed(label, replacement) {
        const altered = { ...op, ...replacement };
        altered.contract = consumerDigest(altered.kind, { record: altered.record.toBuffer(), product: altered.product,
          expiry: altered.expiry, owner: altered.owner.publicKey.toBuffer(), destination: altered.destination.toBuffer(), mint: mint.toBuffer() });
        // Recompute the consumer authority correctly so rejection reaches G's permit binding.
        const keys = [...new Map([op.source, op.destination, altered.destination, op.permit, Q, op.record, altered.record]
          .map(key => [key.toBase58(), key])).values()];
        const before = await snapshotAccounts(keys, `${label}-before`);
        await transport.send(label, [consume(altered)], [op.owner], { expectedError: 705, category: 'adversarial-consumer-binding' });
        assert.deepEqual(await snapshotAccounts(keys, `${label}-after`), before, 'Binding failure mutated native, permit, quota or effect state');
        evidence.checks.push({ label, actualCustomError: 705, consumerPdaRecomputed: true, allTrackedDataUnchanged: true }); await save();
      }
      await changed('changed-destination-binding-rejected', { destination: new PublicKey(assetB.accounts.destination.address) });
      const sku = u64(8), merchantRecord = PublicKey.findProgramAddressSync([Buffer.from('purchase'), op.owner.publicKey.toBuffer(), sku], op.consumer)[0];
      const license = new PublicKey(Buffer.alloc(32, 84)), product = sha256(Buffer.from('adversarial-other-license'));
      const licenseRecord = PublicKey.findProgramAddressSync([Buffer.from('license'), op.owner.publicKey.toBuffer(), product], license)[0];
      for (const [label, consumer, record, input] of [['tamper-merchant', op.consumer, merchantRecord, sku], ['tamper-license', license, licenseRecord, product]]) {
        await prefundPda(label, record);
        await transport.send(`${label}-initialize-record`, [new TransactionInstruction({ programId: consumer,
          data: Buffer.concat([Buffer.from([0]), input]), keys: [
            { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: op.owner.publicKey, isSigner: true, isWritable: false },
            { pubkey: record, isSigner: false, isWritable: true }, { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }] })], [op.owner]);
      }
      await changed('changed-application-action-binding-rejected', { product: sku, record: merchantRecord });
      await changed('changed-consumer-binding-rejected', { kind: 'license', consumer: license, product,
        record: licenseRecord, expiry: (await connection.getSlot('confirmed')) + 950 });
    }
    if (options.scenario === 'conflict') {
      const a = await prepareAndAdmit('a60', 'a', 60);
      const delayed = await prepareOperation('delayed-query', 'a', 1, '99');
      const delayedTicket = await client.stageQuery(delayed.plan, { owner: delayed.owner });
      const b = await prepareAndAdmit('b60-stale', 'b', 60, 1, () => rejectDelayedQuery(delayed, delayedTicket));
      assert.equal(parseQuota(await quotaBytes()).version, '0');
      await bindingFailures(a);
      await reject(a, 'post-native-transfer-merchant-failure-rolls-back', 1099, true);
      await commit(a); await reject(b, 'competing-license-stale-authorization', 803);
      await reject(a, 'consumed-merchant-entitlement-replay', 1001);
      await prepareAndAdmit('b60-honest-fresh', 'b', 60, 2);
      evidence.observer_disclosures.inferred_remaining_allowance = 40;
      assert.equal(parseQuota(await quotaBytes()).version, '1');
    } else {
      const a = await prepareAndAdmit('a40', 'a', 40); await commit(a);
      const b = await prepareAndAdmit('b40-honest-fresh', 'b', 40); await commit(b);
      evidence.observer_disclosures.inferred_remaining_allowance = 20;
      assert.equal(parseQuota(await quotaBytes()).version, '2');
    }
    evidence.finalQuota = parseQuota(await quotaBytes());
    // Include every provisioning/upload receipt in cost accounting, without exposing private files.
    async function collect(path) {
      for (const entry of await readdir(path, { withFileTypes: true })) {
        const full = resolve(path, entry.name);
        if (entry.isDirectory()) await collect(full);
        else if (entry.name.endsWith('-landed.json') && !full.startsWith(transactionsDir)) {
          const receipt = JSON.parse(await readFile(full, 'utf8'));
          evidence.transactions.push({ ...receipt, category: full.includes('/asset-') ? 'native-provisioning' : 'native-proof-and-permit-provisioning' });
        }
      }
    }
    await collect(directory);
    const all = [...evidence.transactions, ...evidence.callbacks.map(item => ({ ...item, category: 'arcium-signed-callback' }))];
    const unique = [...new Map(all.map(item => [item.signature, item])).values()];
    evidence.validatorCostByCategory = {};
    for (const tx of unique) {
      const group = evidence.validatorCostByCategory[tx.category] ??= { transactions: 0, landedCU: 0, feeLamports: 0 };
      group.transactions++; group.landedCU += tx.landedCU ?? 0; group.feeLamports += tx.feeLamports ?? tx.transaction?.meta?.fee ?? 0;
    }
    evidence.passed = true; await save();
    console.log(JSON.stringify({ passed: true, scenario: options.scenario, finalQuota: evidence.finalQuota,
      observerInferredRemainingAllowance: evidence.observer_disclosures.inferred_remaining_allowance, results: resolve(directory, 'results.json') }, null, 2));
    return evidence;
  } catch (error) { evidence.failure = error.stack ?? String(error); await save(); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = {}, names = new Map([['--scenario', 'scenario'], ['--out', 'directory'], ['--rpc', 'endpoint'],
    ['--module-root', 'moduleRoot'], ['--proof-cli', 'proofCli'], ['--payer', 'payerKeyfile'], ['--idl', 'idl'], ['--circuits', 'circuits'], ['--preparation', 'preparation'], ['--prefund-pdas', 'prefundPdas']]);
  try {
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i += 2) { const name = names.get(args[i]); local.ensure(name && !options[name] && args[i + 1], 'Expected unique named option/value pairs'); options[name] = args[i + 1]; }
    for (const name of ['scenario', 'directory', 'moduleRoot', 'proofCli', 'payerKeyfile', 'idl', 'circuits', 'preparation']) local.ensure(options[name], `Missing ${name}`);
    await run(options);
  } catch (error) { console.error(error.stack ?? error); process.exitCode = 1; }
}
