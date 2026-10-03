import assert from 'node:assert/strict';
import { isRpcUnavailable } from '../../sdk/src/rpc-availability.mjs';
import { constants } from 'node:fs';
import { open, mkdir, realpath, readdir, link, unlink } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { createHash, randomUUID, verify } from 'node:crypto';
import { REPO, ensure, loopbackEndpoint } from './runtime.mjs';

const commitment = 'confirmed';
const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function base58(bytes) {
  let value = BigInt(`0x${Buffer.from(bytes).toString('hex') || '0'}`), encoded = '';
  while (value) { encoded = alphabet[Number(value % 58n)] + encoded; value /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; encoded = '1' + encoded; }
  return encoded;
}
async function syncDirectory(directory) { const handle = await open(directory, constants.O_RDONLY); try { await handle.sync(); } finally { await handle.close(); } }
// Publish only complete fsynced records. O_EXCL hard-link publication never overwrites an intent.
async function publish(path, value) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(JSON.stringify(value, null, 2) + '\n'); await file.sync(); } finally { await file.close(); }
  try { await link(temporary, path); await syncDirectory(dirname(path)); }
  finally { await unlink(temporary); await syncDirectory(dirname(path)); }
}
async function readRecord(path) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    ensure(stat.isFile() && stat.uid === process.getuid() && !(stat.mode & 0o077) && stat.size <= 4 * 1024 * 1024, 'Journal record must be a private regular file');
    return JSON.parse(await file.readFile('utf8'));
  } finally { await file.close(); }
}
async function checkedDirectory(directory) {
  const path = resolve(directory), local = resolve(REPO, '.local');
  ensure(path.startsWith(local + sep) && await realpath(path) === path, 'Journal must be a nonsymlink directory beneath repository .local');
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { const stat = await handle.stat(); ensure(stat.isDirectory() && stat.uid === process.getuid() && !(stat.mode & 0o077), 'Journal directory must be private and owned by this user'); }
  finally { await handle.close(); }
  return path;
}
function verifiedTransaction(web3, wire) {
  ensure(wire.length > 0 && wire.length <= 1232, 'Signed transaction exceeds packet bounds');
  const tx = web3.VersionedTransaction.deserialize(wire);
  ensure(tx.version === 0 && Buffer.from(tx.serialize()).equals(wire), 'Expected canonical version-0 transaction');
  ensure(tx.signatures.length === tx.message.header.numRequiredSignatures && tx.signatures.length > 0, 'Invalid signature count');
  const message = Buffer.from(tx.message.serialize());
  for (let i = 0; i < tx.signatures.length; i++) {
    const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), tx.message.staticAccountKeys[i].toBuffer()]);
    ensure(verify(null, message, { key: spki, format: 'der', type: 'spki' }, tx.signatures[i]), 'Invalid signed transaction signature');
  }
  return { tx, message, signatures: tx.signatures.map(base58) };
}
function loadedAddresses(tx, tables) {
  const writable = [], readonly = [];
  for (const lookup of tx.message.addressTableLookups) {
    const table = tables.find(item => item.key.equals(lookup.accountKey));
    ensure(table, 'Missing retained address lookup table');
    for (const [indexes, output] of [[lookup.writableIndexes, writable], [lookup.readonlyIndexes, readonly]]) {
      for (const index of indexes) { ensure(table.state.addresses[index], 'Invalid lookup table index'); output.push(table.state.addresses[index].toBase58()); }
    }
  }
  return { writable, readonly };
}

// RPC receipt instruction bytes serialize as Buffer JSON; deserialized signed
// messages use Uint8Array JSON. Normalize only these two explicit byte encodings.
function jsonMessage(message) {
  const value = JSON.parse(JSON.stringify(message));
  for (const ix of value.compiledInstructions) {
    const data = ix.data?.type === 'Buffer' ? ix.data.data : ix.data;
    ensure(data && typeof data === 'object', 'Invalid retained receipt instruction bytes');
    const bytes = Object.values(data);
    assert.deepEqual(Object.keys(data), bytes.map((_, i) => String(i)), 'Noncanonical retained receipt bytes');
    ensure(bytes.every(byte => Number.isInteger(byte) && byte >= 0 && byte <= 255), 'Invalid retained receipt byte');
    ix.data = bytes;
  }
  return value;
}

/** Local, append-only signed-wire journal. A receipt establishes transaction outcome, not application payment. */
export class DurableTransactionSender {
  constructor(options, manifest) { Object.assign(this, options); this.manifest = manifest; }
  static async create({ web3, connection, endpoint, directory, maxBroadcasts = 3, rpcMaxRetries = 5 }) {
    ensure(Number.isSafeInteger(maxBroadcasts) && maxBroadcasts > 0 && maxBroadcasts <= 10, 'maxBroadcasts must be 1..10');
    ensure(Number.isSafeInteger(rpcMaxRetries) && rpcMaxRetries >= 0 && rpcMaxRetries <= 10, 'rpcMaxRetries must be 0..10');
    const normalized = loopbackEndpoint(endpoint);
    ensure(loopbackEndpoint(connection.rpcEndpoint) === normalized, 'Connection endpoint mismatch');
    const path = resolve(directory);
    // Check parents before mkdir; never follow a symlink to create journal data elsewhere.
    ensure(path.startsWith(resolve(REPO, '.local') + sep) && await realpath(dirname(path)) === dirname(path), 'Invalid journal parent');
    const genesisHash = await connection.getGenesisHash(); new web3.PublicKey(genesisHash);
    await mkdir(path, { mode: 0o700 }); await checkedDirectory(path);
    const manifest = { schemaVersion: 2, genesisHash, endpoint: normalized, commitment, maxBroadcasts, rpcMaxRetries };
    await publish(resolve(path, 'journal.json'), manifest); await syncDirectory(dirname(path));
    return new this({ web3, connection, endpoint: normalized, directory: path }, manifest);
  }
  static async open({ web3, connection, endpoint, directory }) {
    const path = await checkedDirectory(directory), manifest = await readRecord(resolve(path, 'journal.json'));
    const normalized = loopbackEndpoint(endpoint);
    ensure([1, 2].includes(manifest.schemaVersion) && manifest.commitment === commitment && manifest.endpoint === normalized && loopbackEndpoint(connection.rpcEndpoint) === normalized, 'Journal profile/endpoint mismatch');
    ensure(Number.isSafeInteger(manifest.maxBroadcasts) && manifest.maxBroadcasts > 0 && manifest.maxBroadcasts <= 10, 'Invalid journal broadcast limit');
    ensure(manifest.schemaVersion === 1 ? !Object.hasOwn(manifest, 'rpcMaxRetries') : Number.isSafeInteger(manifest.rpcMaxRetries) && manifest.rpcMaxRetries >= 0 && manifest.rpcMaxRetries <= 10, 'Invalid journal RPC retry limit');
    const sender = new this({ web3, connection, endpoint: normalized, directory: path }, manifest);
    await sender.assertGenesis(); return sender;
  }
  get rpcMaxRetries() { return this.manifest.schemaVersion === 1 ? 0 : this.manifest.rpcMaxRetries; }
  async assertGenesis() { ensure(await this.connection.getGenesisHash() === this.manifest.genesisHash, 'Validator genesis differs from signed transaction journal'); }
  async prepare({ label, transaction, blockhash, category = 'application', expectedError, addressLookupTables = [], descriptorSha256, role = label, minContextSlot = 0, requireSimulation = false }) {
    await this.assertGenesis(); await checkedDirectory(this.directory);
    ensure(/^[a-zA-Z0-9_-]{1,120}$/.test(label) && typeof category === 'string' && category.length <= 120 && typeof role === 'string' && role.length <= 120, 'Invalid transaction metadata');
    ensure(expectedError === undefined || Number.isSafeInteger(expectedError) && expectedError >= 0, 'Invalid expected custom error');
    ensure(descriptorSha256 === undefined || /^[a-f0-9]{64}$/.test(descriptorSha256), 'Invalid operation descriptor hash');
    ensure(Number.isSafeInteger(minContextSlot) && minContextSlot >= 0, 'Invalid minimum context slot');
    const wire = Buffer.from(transaction.serialize()), { tx, signatures } = verifiedTransaction(this.web3, wire);
    ensure(tx.message.recentBlockhash === blockhash.blockhash && Number.isSafeInteger(blockhash.lastValidBlockHeight) && blockhash.lastValidBlockHeight >= 0, 'Blockhash metadata differs from signed message');
    const record = { schemaVersion: 1, signature: signatures[0], label, category, role, descriptorSha256, minContextSlot,
      genesisHash: this.manifest.genesisHash, endpoint: this.endpoint, commitment, blockhash, expectedError, requireSimulation,
      wireBase64: wire.toString('base64'), wireSha256: sha(wire), loadedAddresses: loadedAddresses(tx, addressLookupTables) };
    await publish(resolve(this.directory, `${record.signature}.signed.json`), record);
    return { schemaVersion: 1, journalDirectory: this.directory, genesisHash: this.manifest.genesisHash, signature: record.signature, wireSha256: record.wireSha256, role: record.role, descriptorSha256: record.descriptorSha256 ?? null };
  }
  async read(ticket) {
    ensure(ticket?.schemaVersion === 1 && resolve(ticket.journalDirectory) === this.directory && ticket.genesisHash === this.manifest.genesisHash && /^[1-9A-HJ-NP-Za-km-z]{80,90}$/.test(ticket.signature), 'Ticket does not match journal');
    await checkedDirectory(this.directory);
    const record = await readRecord(resolve(this.directory, `${ticket.signature}.signed.json`));
    ensure(record.schemaVersion === 1 && record.signature === ticket.signature && record.genesisHash === this.manifest.genesisHash && record.endpoint === this.endpoint && record.commitment === commitment, 'Signed record binding mismatch');
    ensure(record.wireSha256 === ticket.wireSha256 && record.role === ticket.role && (record.descriptorSha256 ?? null) === ticket.descriptorSha256, 'Ticket semantic binding differs from signed record');
    const wire = Buffer.from(record.wireBase64, 'base64');
    ensure(wire.toString('base64') === record.wireBase64 && sha(wire) === record.wireSha256, 'Signed wire integrity mismatch');
    const verified = verifiedTransaction(this.web3, wire);
    ensure(verified.signatures[0] === ticket.signature && verified.tx.message.recentBlockhash === record.blockhash.blockhash, 'Signed record transaction mismatch');
    ensure(Number.isSafeInteger(record.blockhash.lastValidBlockHeight) && record.blockhash.lastValidBlockHeight >= 0 && Number.isSafeInteger(record.minContextSlot) && record.minContextSlot >= 0, 'Invalid recorded lifetime');
    const files = (await readdir(this.directory)).filter(name => name.startsWith(`${ticket.signature}.attempt-`) && name.endsWith('.json'));
    ensure(files.length <= this.manifest.maxBroadcasts, 'Broadcast journal exceeds limit');
    const broadcasts = [];
    for (let i = 0; i < files.length; i++) {
      const filename = `${ticket.signature}.attempt-${i + 1}.json`;
      ensure(files.includes(filename), 'Noncontiguous broadcast journal');
      const attempt = await readRecord(resolve(this.directory, filename));
      ensure(attempt.signature === ticket.signature && attempt.wireSha256 === record.wireSha256 && attempt.attempt === i + 1, 'Broadcast intent differs from signed wire');
      ensure(this.manifest.schemaVersion === 1 ? attempt.rpcMaxRetries === undefined || attempt.rpcMaxRetries === 0 : attempt.rpcMaxRetries === this.rpcMaxRetries, 'Broadcast intent RPC retry limit differs from journal');
      let response = null;
      try { response = await readRecord(resolve(this.directory, `${ticket.signature}.response-${i + 1}.json`)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (response) {
        ensure(response.signature === ticket.signature && response.wireSha256 === record.wireSha256 && response.attempt === i + 1 && ['accepted', 'error'].includes(response.outcome), 'Broadcast response binding mismatch');
        ensure(response.outcome === 'accepted' ? typeof response.returnedSignature === 'string' : typeof response.error?.message === 'string', 'Malformed broadcast response');
      }
      broadcasts.push({ attempt: i + 1, rpcMaxRetries: attempt.rpcMaxRetries ?? 0, startedAt: attempt.startedAt ?? null, response });
    }
    let simulation;
    try { simulation = await readRecord(resolve(this.directory, `${ticket.signature}.simulation.json`)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (simulation) ensure(simulation.signature === ticket.signature && simulation.wireSha256 === record.wireSha256, 'Simulation binding mismatch');
    let observationSlot = record.minContextSlot;
    // Pre-cursor journals already contain qualified receipt evidence. Keep that
    // floor on first upgrade/restart, without presenting a cached receipt as live.
    for (const name of (await readdir(this.directory)).filter(name => name.startsWith(`${ticket.signature}.receipt-`) && name.endsWith('.json'))) {
      const retained = await readRecord(resolve(this.directory, name)), receipt = retained.receipt;
      ensure(name === `${ticket.signature}.receipt-${sha(JSON.stringify(retained))}.json`
        && retained.signature === ticket.signature && retained.wireSha256 === record.wireSha256 && retained.commitment === commitment, 'Invalid retained receipt binding');
      ensure(Number.isSafeInteger(receipt?.slot) && receipt.slot >= record.minContextSlot && receipt.meta && Object.hasOwn(receipt.meta, 'err'), 'Invalid retained receipt context');
      assert.deepEqual(jsonMessage(receipt.transaction.message), jsonMessage(verified.tx.message), 'Retained receipt message differs');
      assert.deepEqual(receipt.transaction.signatures, verified.signatures, 'Retained receipt signatures differ');
      assert.deepEqual({ writable: receipt.meta.loadedAddresses?.writable ?? [], readonly: receipt.meta.loadedAddresses?.readonly ?? [] }, record.loadedAddresses, 'Retained receipt lookup resolution differs');
      observationSlot = Math.max(observationSlot, receipt.slot);
    }
    for (const name of (await readdir(this.directory)).filter(name => name.startsWith(`${ticket.signature}.context-`) && name.endsWith('.json'))) {
      const cursor = await readRecord(resolve(this.directory, name));
      ensure(cursor.signature === ticket.signature && cursor.wireSha256 === record.wireSha256 && cursor.genesisHash === record.genesisHash
        && Number.isSafeInteger(cursor.slot) && cursor.slot >= record.minContextSlot && name === `${ticket.signature}.context-${cursor.slot}.json`, 'Invalid retained observation context');
      observationSlot = Math.max(observationSlot, cursor.slot);
    }
    return { record, wire, ...verified, attempts: files.length, broadcasts, observationSlot, simulation: simulation?.simulation };
  }
  async recordContext(ticket, slot) {
    const saved = await this.read(ticket);
    ensure(Number.isSafeInteger(slot) && slot >= saved.observationSlot, 'Observation context regressed');
    if (slot === saved.observationSlot) return;
    try { await publish(resolve(this.directory, `${ticket.signature}.context-${slot}.json`), {
      signature: ticket.signature, wireSha256: saved.record.wireSha256, genesisHash: saved.record.genesisHash, slot,
    }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  async recordSimulation(ticket, simulation) {
    const { record } = await this.read(ticket);
    ensure(simulation?.value && Object.hasOwn(simulation.value, 'err'), 'Malformed simulation result');
    await publish(resolve(this.directory, `${ticket.signature}.simulation.json`), { signature: ticket.signature, wireSha256: record.wireSha256, simulation });
  }
  async recover(ticket) {
    await this.assertGenesis(); const saved = await this.read(ticket);
    const { record, signatures, message, attempts, broadcasts, simulation } = saved;
    const result = { observationSlot: saved.observationSlot, availability: [], ticket, signature: record.signature, attempts, canBroadcast: false, record, simulation, broadcasts,
      retryPolicy: { maxBroadcasts: this.manifest.maxBroadcasts, rpcMaxRetries: this.rpcMaxRetries },
      lastSendError: broadcasts.findLast(item => item.response?.outcome === 'error')?.response.error.message };
    let receipt;
    try { receipt = await this.connection.getTransaction(record.signature, { commitment, maxSupportedTransactionVersion: 0 }); }
    catch (error) { if (!isRpcUnavailable(error, 'getTransaction')) throw error; result.availability.push({ method: error.method, category: error.category, status: error.status, code: error.code }); }
    ensure(receipt === null || receipt && typeof receipt === 'object' || result.availability.length, 'Malformed receipt response');
    if (receipt) {
      ensure(Number.isSafeInteger(receipt.slot) && receipt.slot >= record.minContextSlot && receipt.meta && Object.hasOwn(receipt.meta, 'err'), 'Invalid landed receipt context');
      assert.deepEqual(Buffer.from(receipt.transaction.message.serialize()), message, 'Landed message differs from signed bytes');
      assert.deepEqual(receipt.transaction.signatures, signatures, 'Landed signatures differ from signed wire');
      assert.deepEqual({ writable: (receipt.meta.loadedAddresses?.writable ?? []).map(key => key.toBase58()), readonly: (receipt.meta.loadedAddresses?.readonly ?? []).map(key => key.toBase58()) }, record.loadedAddresses, 'Landed address lookup resolution differs');
      const retained = { signature: record.signature, wireSha256: record.wireSha256, commitment, receipt };
      const receiptPath = resolve(this.directory, `${record.signature}.receipt-${sha(JSON.stringify(retained))}.json`);
      try { await publish(receiptPath, retained); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      result.observationSlot = Math.max(result.observationSlot, receipt.slot);
      await this.recordContext(ticket, result.observationSlot);
      return { ...result, status: receipt.meta.err === null ? 'landed' : 'failed', receipt };
    }
    let statuses;
    try { statuses = await this.connection.getSignatureStatuses([record.signature], { searchTransactionHistory: true }); }
    catch (error) { if (!isRpcUnavailable(error, 'getSignatureStatuses')) throw error; result.availability.push({ method: error.method, category: error.category, status: error.status, code: error.code }); }
    ensure(statuses !== undefined || result.availability.some(error => error.method === 'getSignatureStatuses'), 'Malformed signature status response');
    if (statuses !== undefined) {
      ensure(Number.isSafeInteger(statuses?.context?.slot) && statuses.context.slot >= saved.observationSlot, 'Signature status context is older than retained operation context');
      ensure(Array.isArray(statuses.value) && statuses.value.length === 1, 'Malformed signature status response');
      const status = statuses.value[0];
      ensure(status === null || status && Number.isSafeInteger(status.slot) && status.slot >= record.minContextSlot && status.slot <= statuses.context.slot && Object.hasOwn(status, 'err'), 'Malformed signature status');
      result.observationSlot = statuses.context.slot;
      await this.recordContext(ticket, result.observationSlot);
      if (status) return { ...result, status: 'observed-without-receipt', observedStatus: status };
    }
    if (result.availability.length) return { ...result, status: 'delivery-unavailable' };
    const [valid, height] = await Promise.all([this.connection.isBlockhashValid(record.blockhash.blockhash, { commitment, minContextSlot: record.minContextSlot }), this.connection.getBlockHeight(commitment)]);
    ensure(typeof valid.value === 'boolean' && Number.isSafeInteger(height) && height >= 0, 'Invalid blockhash observation');
    if (!valid.value || height > record.blockhash.lastValidBlockHeight) return { ...result, status: 'expired-unresolved' };
    if (record.requireSimulation) {
      if (!simulation) return { ...result, status: 'simulation-required' };
      const expected = record.expectedError;
      if (expected === undefined ? simulation.value.err !== null : simulation.value.err?.InstructionError?.[1]?.Custom !== expected) return { ...result, status: 'simulation-rejected' };
    }
    return { ...result, status: attempts ? 'pending' : 'prepared', canBroadcast: attempts < this.manifest.maxBroadcasts };
  }
  async send(ticket, { pollAttempts = 280, pollIntervalMs = 250, retryEvery = 20 } = {}) {
    ensure(Number.isSafeInteger(pollAttempts) && pollAttempts >= 0 && pollAttempts <= 1000 && Number.isSafeInteger(pollIntervalMs) && pollIntervalMs >= 0 && pollIntervalMs <= 1000 && Number.isSafeInteger(retryEvery) && retryEvery >= 1, 'Invalid bounded polling options');
    let observed = await this.recover(ticket);
    for (let poll = 0; poll <= pollAttempts; poll++) {
      if (observed.availability.length || ['delivery-unavailable', 'landed', 'failed', 'expired-unresolved', 'simulation-required', 'simulation-rejected'].includes(observed.status)) return observed;
      if (observed.canBroadcast && poll % retryEvery === 0) {
        await this.assertGenesis(); const saved = await this.read(ticket);
        ensure(saved.attempts < this.manifest.maxBroadcasts, 'Broadcast limit reached');
        // An interrupted send may have reached RPC. Consume intent before network access, never roll it back.
        await publish(resolve(this.directory, `${ticket.signature}.attempt-${saved.attempts + 1}.json`), {
          signature: ticket.signature, wireSha256: saved.record.wireSha256, attempt: saved.attempts + 1, rpcMaxRetries: this.rpcMaxRetries, startedAt: new Date().toISOString(),
        });
        let signature, failure;
        try { signature = await this.connection.sendRawTransaction(saved.wire, { skipPreflight: saved.record.expectedError !== undefined, preflightCommitment: commitment, maxRetries: this.rpcMaxRetries, minContextSlot: saved.record.minContextSlot }); }
        catch (error) {
          failure = { name: String(error.name ?? 'Error').slice(0, 120), message: String(error.message ?? error).slice(0, 16384) };
          if (typeof error.code === 'number' || typeof error.code === 'string') failure.code = String(error.code).slice(0, 120);
        }
        await publish(resolve(this.directory, `${ticket.signature}.response-${saved.attempts + 1}.json`), {
          signature: ticket.signature, wireSha256: saved.record.wireSha256, attempt: saved.attempts + 1,
          completedAt: new Date().toISOString(), outcome: failure ? 'error' : 'accepted',
          ...(failure ? { error: failure } : { returnedSignature: signature }),
        });
        if (signature !== undefined) ensure(signature === ticket.signature, 'RPC returned a different transaction signature');
        observed = await this.recover(ticket);
      }
      if (poll === pollAttempts) return observed;
      if (pollIntervalMs) await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      observed = await this.recover(ticket);
    }
  }
}
