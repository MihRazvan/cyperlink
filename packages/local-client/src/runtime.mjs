import { createRequire } from 'node:module';
import { open, mkdir, realpath } from 'node:fs/promises';
import { constants, realpathSync } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, verify } from 'node:crypto';

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const PROOF_PROGRAM = 'ZkE1Gama1Proof11111111111111111111111111111';
export const TOKEN_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export function ensure(condition, message) { if (!condition) throw Error(message); }
export function loopbackEndpoint(value) {
  const url = new URL(value);
  ensure(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname), 'Only local HTTP loopback RPC is supported');
  ensure(!url.username && !url.password && !url.search && !url.hash, 'RPC credentials, query and fragment are forbidden');
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url.href;
}
export async function loadWeb3(moduleRoot) {
  const require = createRequire(resolve(moduleRoot, 'package.json'));
  const manifest = require('@solana/web3.js/package.json');
  ensure(manifest.version === '1.99.0', `Expected pinned web3.js 1.99.0, received ${manifest.version}`);
  return require('@solana/web3.js');
}
export async function createPrivateRun(directory) {
  const local = resolve(REPO, '.local'), target = resolve(directory);
  ensure(target.startsWith(local + sep), 'Run output must be beneath this repository .local directory');
  await mkdir(local, { recursive: true, mode: 0o700 });
  ensure((await realpath(local)) === local, 'The .local directory may not be a symlink');
  const parent = dirname(target); await mkdir(parent, { recursive: true, mode: 0o700 });
  ensure((await realpath(parent)).startsWith(local) && (await realpath(parent)) === parent, 'Run parent may not traverse symlinks');
  await mkdir(target, { mode: 0o700 });
  return target;
}
export async function writeNew(path, bytes) {
  const file = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
}
export async function saveSigner(path, keypair) { await writeNew(path, JSON.stringify(Array.from(keypair.secretKey))); }
export async function loadSigner(path, web3) {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    ensure(stat.isFile() && (stat.mode & 0o077) === 0 && stat.uid === process.getuid(), 'Signing key must be a private regular file owned by this user');
    ensure(stat.size <= 1024, 'Oversized signing key file');
    return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await file.readFile('utf8'))));
  } finally { await file.close(); }
}
export function instructionFromJSON(raw, web3) {
  ensure(raw && typeof raw.program === 'string' && /^[a-fA-F0-9]*$/.test(raw.data) && raw.data.length % 2 === 0 && Array.isArray(raw.accounts), 'Malformed instruction artifact');
  return new web3.TransactionInstruction({ programId: new web3.PublicKey(raw.program), data: Buffer.from(raw.data, 'hex'), keys: raw.accounts.map(meta => {
    ensure(typeof meta.signer === 'boolean' && typeof meta.writable === 'boolean', 'Malformed instruction account flags');
    return { pubkey: new web3.PublicKey(meta.key), isSigner: meta.signer, isWritable: meta.writable };
  }) });
}
export class LocalSession {
  constructor({ web3, endpoint, payer, directory, fetch = globalThis.fetch }) {
    ensure(resolve(directory).startsWith(resolve(REPO, '.local') + sep) && realpathSync(directory) === resolve(directory), 'Session output must be an existing nonsymlink directory beneath repository .local');
    this.web3 = web3; this.endpoint = loopbackEndpoint(endpoint); this.payer = payer; this.directory = directory; this.sequence = 0;
    this.connection = new web3.Connection(this.endpoint, { commitment: 'confirmed', disableRetryOnRateLimit: true,
      fetch: (url, options) => { ensure(loopbackEndpoint(url) === this.endpoint, 'Unexpected RPC endpoint'); return fetch(url, { ...options, redirect: 'error' }); } });
  }
  async assertLocalVersions() {
    const version = await this.connection.getVersion();
    ensure(version['solana-core'] === '4.3.0', 'Expected pinned local Agave 4.3.0');
    return version;
  }
  async send(label, instructions, additionalSigners = []) {
    ensure(/^[a-zA-Z0-9_-]+$/.test(label), 'Invalid transaction label');
    const { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } = this.web3;
    const latest = await this.connection.getLatestBlockhash('confirmed');
    const transaction = new VersionedTransaction(new TransactionMessage({ payerKey: this.payer.publicKey, recentBlockhash: latest.blockhash,
      instructions: [ComputeBudgetProgram.setComputeUnitLimit({ units: 600000 }), ...instructions] }).compileToV0Message());
    const signers = [...new Map([this.payer, ...additionalSigners].map(signer => [signer.publicKey.toBase58(), signer])).values()];
    transaction.sign(signers); const wire = transaction.serialize();
    ensure(wire.length <= 1232, `Transaction ${label} exceeds native 1232-byte packet limit (${wire.length})`);
    for (let i = 0; i < transaction.message.header.numRequiredSignatures; i++) {
      const spki = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), transaction.message.staticAccountKeys[i].toBuffer()]);
      ensure(verify(null, transaction.message.serialize(), { key: spki, format: 'der', type: 'spki' }, transaction.signatures[i]), 'Locally assembled owner signature failed verification');
    }
    const stem = `${String(this.sequence++).padStart(3, '0')}-${label}`;
    await writeNew(resolve(this.directory, `${stem}-signed.json`), JSON.stringify({ label, rpc: this.endpoint, blockhash: latest,
      signedTransactionBase64: Buffer.from(wire).toString('base64'), classification: 'public-signed-local-transaction' }, null, 2));
    const simulation = await this.connection.simulateTransaction(transaction, { sigVerify: true, commitment: 'confirmed' });
    ensure(!simulation.value.err, `Simulation ${label} failed: ${JSON.stringify(simulation.value)}`);
    const signature = await this.connection.sendRawTransaction(wire, { skipPreflight: false, maxRetries: 0, preflightCommitment: 'confirmed' });
    let landed;
    for (let attempt = 0; attempt < 100; attempt++) {
      const status = (await this.connection.getSignatureStatuses([signature])).value[0];
      if (status?.err) throw Error(`Transaction ${label} rejected: ${JSON.stringify(status.err)}`);
      if (status && ['confirmed', 'finalized'].includes(status.confirmationStatus)) {
        landed = await this.connection.getTransaction(signature, { commitment: 'confirmed', maxSupportedTransactionVersion: 0 });
        if (landed) break;
      }
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    ensure(landed && !landed.meta.err, `Transaction confirmation/evidence unavailable: ${label} ${signature}; do not recreate keys or silently repeat provisioning`);
    ensure(Buffer.from(landed.transaction.message.serialize()).equals(Buffer.from(transaction.message.serialize())), 'RPC landed message differs from signed message');
    const evidence = { label, signature, rpc: this.endpoint, slot: landed.slot, bytes: wire.length, signaturesVerified: true,
      simulatedCU: simulation.value.unitsConsumed, landedCU: landed.meta.computeUnitsConsumed, transaction: landed };
    await writeNew(resolve(this.directory, `${stem}-landed.json`), JSON.stringify(evidence, null, 2));
    return evidence;
  }
  async createAccount(keypair, space, owner, following = [], signers = [], label = 'create-account') {
    ensure(Number.isSafeInteger(space) && space > 0 && space <= 16384, 'Unsupported local account allocation');
    const lamports = await this.connection.getMinimumBalanceForRentExemption(space, 'confirmed');
    const create = this.web3.SystemProgram.createAccount({ fromPubkey: this.payer.publicKey, newAccountPubkey: keypair.publicKey,
      lamports, space, programId: new this.web3.PublicKey(owner) });
    return this.send(label, [create, ...following], [keypair, ...signers]);
  }
  async snapshot(address, filename) {
    const result = await this.connection.getAccountInfoAndContext(address, { commitment: 'confirmed' });
    ensure(result.value, `Missing provisioned account ${address}`);
    const account = result.value;
    await writeNew(resolve(this.directory, filename), account.data);
    return { address: address.toBase58(), owner: account.owner.toBase58(), size: account.data.length,
      sha256: createHash('sha256').update(account.data).digest('hex'), slot: result.context.slot };
  }
}
