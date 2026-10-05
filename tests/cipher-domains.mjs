// Synthetic local compatibility check. No RPC, keys from disk or real inputs.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(resolve(process.argv[2], 'package.json'));
const { RescueCipher, CSplRescueCipher } = require('@arcium-hq/client');
const syntheticSecret = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const syntheticNonce = Uint8Array.from({ length: 16 }, (_, i) => i + 10);
const values = [40n, 100n, 4n];
const base = new RescueCipher(syntheticSecret);
const scalar = new CSplRescueCipher(syntheticSecret);
const baseCipher = base.encrypt(values, syntheticNonce);
const scalarCipher = scalar.encrypt(values, syntheticNonce);
assert.deepEqual(base.decrypt(baseCipher, syntheticNonce), values);
assert.deepEqual(scalar.decrypt(scalarCipher, syntheticNonce), values);
assert.notDeepEqual(baseCipher, scalarCipher);
let wrongDomainRejected = false;
try {
  wrongDomainRejected = base.decrypt(scalarCipher, syntheticNonce).some((x, i) => x !== values[i]);
} catch { wrongDomainRejected = true; }
assert.equal(wrongDomainRejected, true);
console.log(JSON.stringify({ evidence: 'synthetic local JS compatibility', ownDomainRoundTrips: 2,
  sameInputDifferentCiphertexts: true, scalarCiphertextNotValidAsBaseInput: true,
  networkAccess: false, productionSecrets: false }));
