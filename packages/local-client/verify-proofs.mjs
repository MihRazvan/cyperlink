#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadWeb3, loadSigner, LocalSession, ensure } from './src/runtime.mjs';
import { verifyTransferProofs } from './src/proofs.mjs';
const options = {}, names = new Map([['--prepared', 'directory'], ['--rpc', 'endpoint'], ['--module-root', 'moduleRoot'], ['--payer', 'payerKeyfile']]);
try {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const name = names.get(args[i]); ensure(name && !options[name] && args[i + 1], 'Expected unique option/value pairs'); options[name] = args[i + 1];
  }
  for (const key of ['directory', 'moduleRoot', 'payerKeyfile']) ensure(options[key], `Missing ${key}`);
  const web3 = await loadWeb3(options.moduleRoot), payer = await loadSigner(options.payerKeyfile, web3);
  const session = new LocalSession({ web3, payer, directory: resolve(options.directory), endpoint: options.endpoint ?? 'http://127.0.0.1:8899' });
  await session.assertLocalVersions();
  const prepared = JSON.parse(await readFile(resolve(options.directory, 'prepared-transfer.json'), 'utf8')), signers = {};
  for (const name of ['equality', 'grouped', 'range']) signers[name] = await loadSigner(resolve(options.directory, `${name}-context-signer.json`), web3);
  const evidence = await verifyTransferProofs(session, prepared, signers, { bufferProgram: new web3.PublicKey(Buffer.alloc(32, 89)).toBase58() });
  console.log(JSON.stringify({ evidence_level: 'real-local-validator-native-proof-verification', verified: evidence.map(tx => ({ label: tx.label, signature: tx.signature, slot: tx.slot })) }, null, 2));
} catch (error) { console.error(`Native proof verification failed: ${error.message}`); process.exitCode = 1; }
