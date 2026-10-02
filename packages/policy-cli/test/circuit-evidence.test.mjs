import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { verifyUploadedCircuit } from '../src/circuit-evidence.mjs';
const require = createRequire(resolve('.local/toolchain/js/package.json'));
const ar = require('@arcium-hq/client');
const { BN } = require('@anchor-lang/core');
const { PublicKey } = require('@solana/web3.js');
const owner = ar.getArciumProgramId(), payer = new PublicKey(Buffer.alloc(32, 71));
const coder = ar.getArciumProgram({ connection: {}, publicKey: payer }).coder.accounts;
const definition = ar.getCompDefAccAddress(new PublicKey(Buffer.alloc(32, 72)), 77);
const ct = () => ({ type: 'ciphertext', size_in_bits: 253 });
const interfaceValue = { name: 'runtime_policy_init', inputs: [{ type: 'arcis_x25519_pubkey' }, { type: 'u128', size_in_bits: 128 },
  { type: 'array', content: Array.from({ length: 4 }, ct) }, { type: 'u128', size_in_bits: 128 }],
  outputs: [{ type: 'bool' }, { type: 'array', content: Array.from({ length: 4 }, ct) }] };

async function fixture(change = () => {}) {
  const bytes = Buffer.from('synthetic compiler bytes for RPC guard testing, not a deployed circuit');
  const state = { deactivationSlot: null, cuAmount: new BN(794133188),
    definition: { circuitLen: bytes.length, signature: {
      parameters: [{ arcisX25519Pubkey: {} }, { plaintextU128: {} }, ...Array.from({ length: 4 }, () => ({ ciphertext: {} })), { plaintextU128: {} }],
      outputs: [{ plaintextBool: {} }, ...Array.from({ length: 4 }, () => ({ ciphertext: {} }))],
    } }, circuitSource: { onChain: [{ isCompleted: true, uploadAuth: payer }] }, bump: 254, padding: Array(24).fill(0) };
  const raw = { owner, executable: false, data: Buffer.concat([Buffer.from([226, 70, 57, 224, 38, 233, 59, 136, 253]), bytes]) };
  const iface = structuredClone(interfaceValue);
  const options = { state, raw, iface, definitionOwner: owner, contextSlot: 91 };
  change(options);
  const definitionAccount = { owner: options.definitionOwner, executable: false, data: await coder.encode('computationDefinitionAccount', state) };
  let reads = 0;
  const connection = { async getMultipleAccountsInfoAndContext(keys, config) {
    assert.deepEqual(keys.map(key => key.toBase58()), [definition, ar.getRawCircuitAccAddress(definition, 0)].map(key => key.toBase58()));
    assert.equal(config.commitment, 'confirmed'); reads++;
    return { context: { slot: options.contextSlot }, value: [definitionAccount, raw] };
  } };
  return { args: { connection, ar, arcium: { programId: owner, coder: { accounts: coder } }, definition, payer, bytes, interfaceBytes: Buffer.from(JSON.stringify(iface)) }, reads: () => reads };
}

test('pinned Anchor decoding verifies complete uploaded bytes and interface from one bank', async () => {
  const { args, reads } = await fixture();
  const report = await verifyUploadedCircuit(args);
  assert.equal(reads(), 1);
  assert.equal(report.contextSlot, 91);
  assert.equal(report.qualification, 'confirmed-rpc-circuit-byte-comparison');
  assert.equal(report.uploadedCircuitSha256, report.circuitSha256);
  assert.deepEqual(Buffer.from(report.rawAccounts[0].dataBase64, 'base64').subarray(9), args.bytes);
  assert.equal(report.registeredSignature.parameters.length, 7);
  assert.equal(report.registeredSignature.outputs.length, 5);
  assert.doesNotThrow(() => JSON.stringify(report));
});

test('rejects damaged, wrong-owner, truncated and incomplete uploaded circuits', async () => {
  const changes = [
    [v => { v.raw.data[v.raw.data.length - 1] ^= 1; }, /Uploaded circuit bytes differ/],
    [v => { v.raw.owner = payer; }, /Wrong circuit account owner/],
    [v => { v.definitionOwner = payer; }, /Wrong circuit account owner/],
    [v => { v.raw.data = v.raw.data.subarray(0, -1); }, /Truncated raw circuit account/],
    [v => { v.raw.data[0] ^= 1; }, /Wrong circuit account discriminator/],
    [v => { v.raw.executable = true; }, /Missing or executable/],
    [v => { v.state.circuitSource.onChain[0].isCompleted = false; }, /not complete/],
    [v => { v.state.circuitSource.onChain[0].uploadAuth = owner; }, /authority mismatch/],
    [v => { v.state.deactivationSlot = new BN(90); }, /deactivated/],
    [v => { v.state.definition.circuitLen++; }, /length mismatch/],
    [v => { v.state.definition.signature.parameters[1] = { plaintextU64: {} }; }, /interface mismatch/],
    [v => { v.state.definition.signature.outputs.push({ plaintextU64: {} }); }, /interface mismatch/],
  ];
  for (const [change, expected] of changes) {
    const { args } = await fixture(change);
    await assert.rejects(verifyUploadedCircuit(args), expected);
  }
});

test('rejects cross-domain or undeclared public interface before reading chain state', async () => {
  for (const change of [
    v => { v.iface.inputs[2].content[0].size_in_bits = 255; },
    v => { v.iface.outputs.push({ type: 'u64', size_in_bits: 64 }); },
    v => { v.iface.inputs[2].content.pop(); },
    v => { v.iface.name = 'unauthorized_policy'; },
  ]) {
    const { args, reads } = await fixture(change);
    await assert.rejects(verifyUploadedCircuit(args), /Unsupported policy circuit/);
    assert.equal(reads(), 0);
  }
});
