#!/usr/bin/env node
import { prepareNativeTransfer } from './src/prepare-transfer.mjs';
const options = {}, names = new Map([['--out', 'directory'], ['--provisioned', 'provisionedDirectory'], ['--amount', 'amount'],
  ['--rpc', 'endpoint'], ['--module-root', 'moduleRoot'], ['--proof-cli', 'proofCli'], ['--payer', 'payerKeyfile']]);
try {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const name = names.get(args[i]); if (!name || options[name] || !args[i + 1]) throw Error('Expected unique option/value pairs');
    options[name] = name === 'amount' ? Number(args[i + 1]) : args[i + 1];
  }
  for (const key of ['directory', 'provisionedDirectory', 'amount', 'moduleRoot', 'proofCli', 'payerKeyfile']) if (!options[key]) throw Error(`Missing ${key}`);
  const result = await prepareNativeTransfer(options);
  console.log(JSON.stringify({ evidence_level: 'client-proof-preparation-from-live-account', directory: result.directory,
    source: result.snapshot, proof_types: result.prepared.proofs.map(proof => proof.name), native_verification_required: true }, null, 2));
} catch (error) { console.error(`Local transfer preparation failed: ${error.message}`); process.exitCode = 1; }
