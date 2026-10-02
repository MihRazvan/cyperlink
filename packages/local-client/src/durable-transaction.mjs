import assert from 'node:assert/strict';
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

/** Local, append-only signed-wire journal. A receipt establishes transaction outcome, not application payment. */
export class DurableTransactionSender {
  constructor(options, manifest) { Object.assign(this, options); this.manifest = manifest; }
  static async create({ web3, connection, endpoint, directory, maxBroadcasts = 3 }) {
    ensure(Number.isSafeInteger(maxBroadcasts) && maxBroadcasts > 0 && maxBroadcasts <= 10, 'maxBroadcasts must be 1..10');
    const normalized = loopbackEndpoint(endpoint);
    ensure(loopbackEndpoint(connection.rpcEndpoint) === normalized, 'Connection endpoint mismatch');
    const path = resolve(directory);
    // Check parents before mkdir; never follow a symlink to create journal data elsewhere.
    ensure(path.startsWith(resolve(REPO, '.local') + sep) && await realpath(dirname(path)) === dirname(path), 'Invalid journal parent');
    const genesisHash = await connection.getGenesisHash(); new web3.PublicKey(genesisHash);
    await mkdir(path, { mode: 0o700 }); await checkedDirectory(path);
    const manifest = { schemaVersion: 1, genesisHash, endpoint: normalized, commitment, maxBroadcasts };
    await publish(resolve(path, 'journal.json'), manifest); await syncDirectory(dirname(path));
    return new this({ web3, connection, endpoint: normalized, directory: path }, manifest);
  }
  static async open({ web3, connection, endpoint, directory }) {
    const path = await checkedDirectory(directory), manifest = await readRecord(resolve(path, 'journal.json'));
    const normalized = loopbackEndpoint(endpoint);
    ensure(manifest.schemaVersion === 1 && manifest.commitment === commitment && manifest.endpoint === normalized && loopbackEndpoint(connection.rpcEndpoint) === normalized, 'Journal profile/endpoint mismatch');
    ensure(Number.isSafeInteger(manifest.maxBroadcasts) && manifest.maxBroadcasts > 0 && manifest.maxBroadcasts <= 10, 'Invalid journal broadcast limit');
    const sender = new this({ web3, connection, endpoint: normalized, directory: path }, manifest);
    await sender.assertGenesis(); return sender;
  }
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
    for (let i = 0; i < files.length; i++) {
      const filename = `${ticket.signature}.attempt-${i + 1}.json`;
      ensure(files.includes(filename), 'Noncontiguous broadcast journal');
      const attempt = await readRecord(resolve(this.directory, filename));
      ensure(attempt.signature === ticket.signature && attempt.wireSha256 === record.wireSha256 && attempt.attempt === i + 1, 'Broadcast intent differs from signed wire');
    }
    let simulation;
    try { simulation = await readRecord(resolve(this.directory, `${ticket.signature}.simulation.json`)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (simulation) ensure(simulation.signature === ticket.signature && simulation.wireSha256 === record.wireSha256, 'Simulation binding mismatch');
    return { record, wire, ...verified, attempts: files.length, simulation: simulation?.simulation };
  }
  async recordSimulation(ticket, simulation) {
    const { record } = await this.read(ticket);
    ensure(simulation?.value && Object.hasOwn(simulation.value, 'err'), 'Malformed simulation result');
    await publish(resolve(this.directory, `${ticket.signature}.simulation.json`), { signature: ticket.signature, wireSha256: record.wireSha256, simulation });
  }
  async recover(ticket) {
    await this.assertGenesis(); const saved = await this.read(ticket);
    const { record, signatures, message, attempts, simulation } = saved;
    const result = { ticket, signature: record.signature, attempts, canBroadcast: false, record, simulation };
    const receipt = await this.connection.getTransaction(record.signature, { commitment, maxSupportedTransactionVersion: 0 });
    if (receipt) {
      ensure(Number.isSafeInteger(receipt.slot) && receipt.slot >= record.minContextSlot && receipt.meta && Object.hasOwn(receipt.meta, 'err'), 'Invalid landed receipt context');
      assert.deepEqual(Buffer.from(receipt.transaction.message.serialize()), message, 'Landed message differs from signed bytes');
      assert.deepEqual(receipt.transaction.signatures, signatures, 'Landed signatures differ from signed wire');
      assert.deepEqual({ writable: (receipt.meta.loadedAddresses?.writable ?? []).map(key => key.toBase58()), readonly: (receipt.meta.loadedAddresses?.readonly ?? []).map(key => key.toBase58()) }, record.loadedAddresses, 'Landed address lookup resolution differs');
      const retained = { signature: record.signature, wireSha256: record.wireSha256, commitment, receipt };
      const receiptPath = resolve(this.directory, `${record.signature}.receipt-${sha(JSON.stringify(retained))}.json`);
      try { await publish(receiptPath, retained); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      return { ...result, status: receipt.meta.err === null ? 'landed' : 'failed', receipt };
    }
    const statuses = await this.connection.getSignatureStatuses([record.signature], { searchTransactionHistory: true });
    ensure(Number.isSafeInteger(statuses.context.slot) && statuses.context.slot >= record.minContextSlot, 'Signature status context is older than retained operation context');
    if (statuses.value[0]) return { ...result, status: 'observed-without-receipt', observedStatus: statuses.value[0] };
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
    let observed = await this.recover(ticket), lastSendError;
    for (let poll = 0; poll <= pollAttempts; poll++) {
      if (['landed', 'failed', 'expired-unresolved', 'simulation-required', 'simulation-rejected'].includes(observed.status)) return { ...observed, lastSendError };
      if (observed.canBroadcast && poll % retryEvery === 0) {
        await this.assertGenesis(); const saved = await this.read(ticket);
        ensure(saved.attempts < this.manifest.maxBroadcasts, 'Broadcast limit reached');
        // An interrupted send may have reached RPC. Consume intent before network access, never roll it back.
        await publish(resolve(this.directory, `${ticket.signature}.attempt-${saved.attempts + 1}.json`), {
          signature: ticket.signature, wireSha256: saved.record.wireSha256, attempt: saved.attempts + 1,
        });
        let signature;
        try { signature = await this.connection.sendRawTransaction(saved.wire, { skipPreflight: saved.record.expectedError !== undefined, preflightCommitment: commitment, maxRetries: 0, minContextSlot: saved.record.minContextSlot }); }
        catch (error) { lastSendError = String(error.message ?? error); }
        if (signature !== undefined) ensure(signature === ticket.signature, 'RPC returned a different transaction signature');
        observed = await this.recover(ticket);
      }
      if (poll === pollAttempts) return { ...observed, lastSendError };
      if (pollIntervalMs) await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
      observed = await this.recover(ticket);
    }
  }
}
