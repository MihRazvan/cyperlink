import assert from 'node:assert/strict';
import { verify as verifySignature } from 'node:crypto';
import { resolve } from 'node:path';
import { ensure, writeNew } from '../../packages/local-client/src/runtime.mjs';
export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Real signed sends with cached ALT, exact failures and committed receipt capture. */
export class DemoTransport {
  constructor(session, record) { this.session = session; this.record = record; this.sequence = 0; this.lookup = null; }
  async lookupFor(ixs) {
    const { web3, connection, payer } = this.session;
    if (!this.lookup) {
      const [create, key] = web3.AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey,
        payer: payer.publicKey, recentSlot: await connection.getSlot('finalized') });
      await this.send('create-demo-alt', [create], [], { alt: false, category: 'lookup-table' });
      this.lookup = key;
    }
    let table = (await connection.getAddressLookupTable(this.lookup)).value;
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
  async send(label, ixs, additionalSigners = [], { expectedError, alt = true, category = 'application' } = {}) {
    const { web3, connection, payer, directory } = this.session;
    const instructions = [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1300000 }), ...ixs];
    const signers = [...new Map([payer, ...additionalSigners].map(signer => [signer.publicKey.toBase58(), signer])).values()];
    let latest = await connection.getLatestBlockhash('confirmed');
    const assemble = tables => {
      const tx = new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: payer.publicKey,
        recentBlockhash: latest.blockhash, instructions }).compileToV0Message(tables));
      tx.sign(signers); return tx;
    };
    let tx = assemble([]), size;
    try { size = tx.serialize().length; } catch { size = Infinity; }
    if (size > 1232 && alt) {
      const table = await this.lookupFor(ixs); latest = await connection.getLatestBlockhash('confirmed');
      tx = assemble([table]); size = tx.serialize().length;
    }
    ensure(size <= 1232, `Transaction too large: ${label} ${size}`);
    for (let i = 0; i < tx.message.header.numRequiredSignatures; i++) {
      const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), tx.message.staticAccountKeys[i].toBuffer()]);
      ensure(verifySignature(null, tx.message.serialize(), { key: spki, format: 'der', type: 'spki' }, tx.signatures[i]), 'Bad assembled signature');
    }
    const stem = `${String(this.sequence++).padStart(3, '0')}-${label}`;
    await writeNew(resolve(directory, `${stem}-signed.json`), JSON.stringify({ label, signedTransactionBase64: Buffer.from(tx.serialize()).toString('base64') }, null, 2));
    const simulation = await connection.simulateTransaction(tx, { sigVerify: true, commitment: 'confirmed' });
    if (expectedError === undefined) ensure(!simulation.value.err, `${label}: ${JSON.stringify(simulation.value)}`);
    else ensure(simulation.value.err?.InstructionError?.[1]?.Custom === expectedError,
      `${label}: wrong simulated cause ${JSON.stringify(simulation.value)}`);
    const wire = tx.serialize();
    const signature = await connection.sendRawTransaction(wire, { skipPreflight: expectedError !== undefined, maxRetries: 5 });
    let landed;
    for (let attempt = 0; attempt < 280; attempt++) {
      landed = await connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
      if (landed) break; await sleep(250);
      if (attempt > 0 && attempt % 20 === 0) {
        const status = (await connection.getSignatureStatuses([signature], { searchTransactionHistory: true })).value[0];
        if (!status) {
          const valid = await connection.isBlockhashValid(latest.blockhash, 'confirmed');
          if (!valid.value) break;
          // Same signed bytes/signature only: never allocate another operation or nonce.
          assert.equal(await connection.sendRawTransaction(wire, { skipPreflight: true, maxRetries: 5 }), signature);
        }
      }
    }
    ensure(landed, `Receipt timeout ${signature}; preserve run and inspect before retrying`);
    assert.deepEqual(Buffer.from(landed.transaction.message.serialize()), Buffer.from(tx.message.serialize()));
    if (expectedError === undefined) assert.equal(landed.meta.err, null, `${label} failed`);
    else assert.equal(landed.meta.err?.InstructionError?.[1]?.Custom, expectedError, `${label} wrong actual rejection cause`);
    const result = { label, category, signature, bytes: size, slot: landed.slot, signaturesVerified: true,
      simulatedCU: simulation.value.unitsConsumed, landedCU: landed.meta.computeUnitsConsumed, feeLamports: landed.meta.fee,
      error: landed.meta.err, transaction: landed };
    await writeNew(resolve(directory, `${stem}-landed.json`), JSON.stringify(result, null, 2));
    await this.record(result);
    console.log(`${label}: ${expectedError === undefined ? 'committed' : `rejected ${expectedError}`} ${signature}`);
    return result;
  }
}
