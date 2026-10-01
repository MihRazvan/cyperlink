#!/usr/bin/env node
import { provision } from './src/provision.mjs';
const options = {};
const names = new Map([['--out', 'directory'], ['--rpc', 'endpoint'], ['--module-root', 'moduleRoot'], ['--proof-cli', 'proofCli'], ['--payer', 'payerKeyfile']]);
try {
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 2) {
    const name = names.get(args[i]); if (!name || options[name] || !args[i + 1]) throw Error('Expected unique option/value pairs: --out --module-root --proof-cli --payer [--rpc]');
    options[name] = args[i + 1];
  }
  for (const key of ['directory', 'moduleRoot', 'proofCli', 'payerKeyfile']) if (!options[key]) throw Error(`Missing ${key}`);
  const result = await provision(options);
  console.log(JSON.stringify({ evidence_level: result.evidence_level, rpc: result.rpc, accounts: result.accounts, initial_amount: result.initial_amount }, null, 2));
} catch (error) { console.error(`Local provisioning failed: ${error.message}`); process.exitCode = 1; }
