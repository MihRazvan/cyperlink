import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { ensure } from './runtime.mjs';
import { DurableTransactionSender } from './durable-transaction.mjs';
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Explicit signing + simulation; submissions and recovery retain exactly the staged wire. */
export class SignedInstructionSender {
  constructor(session, record = async () => {}) { this.session = session; this.record = record; this.lookup = null; this.journal = null; }
  async durable() {
    if (!this.journal) {
      const options = { web3: this.session.web3, connection: this.session.connection, endpoint: this.session.endpoint ?? this.session.connection.rpcEndpoint,
        directory: resolve(this.session.directory, 'transaction-journal') };
      this.journal = (async () => {
        try { return await DurableTransactionSender.open(options); }
        catch (error) { if (error.code !== 'ENOENT') throw error; return DurableTransactionSender.create(options); }
      })();
    }
    return this.journal;
  }
  async lookupFor(ixs) {
    const { web3, connection, payer } = this.session;
    if (!this.lookup) {
      const [create, key] = web3.AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey,
        payer: payer.publicKey, recentSlot: await connection.getSlot('finalized') });
      await this.send('create-demo-alt', [create], [], { alt: false, category: 'lookup-table' }); this.lookup = key;
    }
    let table = (await connection.getAddressLookupTable(this.lookup)).value;
    ensure(table, 'Address lookup table missing');
    const existing = new Set(table.state.addresses.map(key => key.toBase58()));
    const wanted = [...new Map(ixs.flatMap(ix => [ix.programId, ...ix.keys.map(meta => meta.pubkey)])
      .map(key => [key.toBase58(), key])).values()].filter(key => !existing.has(key.toBase58()));
    for (let start = 0; start < wanted.length; start += 20) {
      await this.send('extend-demo-alt', [web3.AddressLookupTableProgram.extendLookupTable({ lookupTable: this.lookup,
        authority: payer.publicKey, payer: payer.publicKey, addresses: wanted.slice(start, start + 20) })], [], { alt: false, category: 'lookup-table' });
    }
    table = (await connection.getAddressLookupTable(this.lookup)).value;
    for (let attempt = 0; await connection.getSlot('confirmed') <= table.state.lastExtendedSlot; attempt++) {
      ensure(attempt < 100, 'ALT activation timeout'); await sleep(100);
    }
    return table;
  }
  async stage(label, ixs, additionalSigners = [], { expectedError, alt = true, category = 'application', descriptorSha256, role = label, minContextSlot = 0 } = {}) {
    const { web3, connection, payer } = this.session;
    ensure(payer?.publicKey, 'Staging requires an explicit local signing wallet');
    const journal = await this.durable(); await journal.assertGenesis();
    const instructions = [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1300000 }), ...ixs];
    const signers = [...new Map([payer, ...additionalSigners].map(signer => [signer.publicKey.toBase58(), signer])).values()];
    let latest = await connection.getLatestBlockhash('confirmed');
    const assemble = tables => {
      const tx = new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: payer.publicKey,
        recentBlockhash: latest.blockhash, instructions }).compileToV0Message(tables));
      tx.sign(signers); return tx;
    };
    let tables = [], tx = assemble(tables), size;
    try { size = tx.serialize().length; } catch { size = Infinity; }
    if (size > 1232 && alt) {
      tables = [await this.lookupFor(ixs)]; latest = await connection.getLatestBlockhash('confirmed');
      tx = assemble(tables); size = tx.serialize().length;
    }
    ensure(size <= 1232, `Transaction too large: ${label} ${size}`);
    // Signed wire exists durably even if simulation RPC loses its response or the process exits.
    const ticket = await journal.prepare({ label, transaction: tx, blockhash: latest, category, expectedError,
      addressLookupTables: tables, descriptorSha256, role, minContextSlot, requireSimulation: true });
    const simulation = await connection.simulateTransaction(tx, { sigVerify: true, commitment: 'confirmed', minContextSlot });
    await journal.recordSimulation(ticket, simulation);
    if (expectedError === undefined) ensure(!simulation.value.err, `${label}: ${JSON.stringify(simulation.value)}`);
    else ensure(simulation.value.err?.InstructionError?.[1]?.Custom === expectedError, `${label}: wrong simulated cause ${JSON.stringify(simulation.value)}`);
    // Simulation is auxiliary evidence, not authorization. Submission always validates the immutable wire.
    return { ...ticket, simulatedCU: simulation.value.unitsConsumed };
  }
  result(observed, ticket) {
    const { record, receipt } = observed;
    return { label: record.label, category: record.category, signature: observed.signature,
      bytes: Buffer.from(record.wireBase64, 'base64').length, slot: receipt.slot, signaturesVerified: true,
      simulatedCU: observed.simulation?.value.unitsConsumed, landedCU: receipt.meta.computeUnitsConsumed, feeLamports: receipt.meta.fee,
      error: receipt.meta.err, transaction: receipt };
  }
  async recover(ticket) {
    const observed = await (await this.durable()).recover(ticket);
    return observed.receipt ? { ...observed, result: this.result(observed, ticket) } : observed;
  }
  async submit(ticket, options) {
    const observed = await (await this.durable()).send(ticket, options);
    if (!observed.receipt) {
      const error = Error(`Receipt unresolved (${observed.status}) ${ticket.signature}; retain ticket and reconcile before any fresh authorization`);
      error.ticket = ticket; error.recovery = observed; throw error;
    }
    const result = this.result(observed, ticket);
    if (observed.record.expectedError === undefined) assert.equal(result.error, null, `${result.label} failed`);
    else assert.equal(result.error?.InstructionError?.[1]?.Custom, observed.record.expectedError, `${result.label} wrong actual rejection cause`);
    await this.record(result);
    console.log(`${result.label}: ${result.error === null ? 'committed' : `rejected ${observed.record.expectedError}`} ${result.signature}`);
    return result;
  }
  async send(label, ixs, additionalSigners = [], options = {}) { return this.submit(await this.stage(label, ixs, additionalSigners, options)); }
}
