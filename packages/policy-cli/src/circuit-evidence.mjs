import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

const ARCIUM_PROGRAM = 'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ';
const HEADER = 9, MAX_PAYLOAD = 10 * 1024 * 1024 - HEADER;
const RAW_DISCRIMINATOR = Buffer.from([226, 70, 57, 224, 38, 233, 59, 136]);
const DEFINITION_DISCRIMINATOR = Buffer.from([245, 176, 217, 221, 253, 104, 172, 200]);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const address = key => key.toBase58();

function expectedSignature(interfaceBytes) {
  const iface = JSON.parse(Buffer.from(interfaceBytes).toString('utf8'));
  const ct = () => ({ type: 'ciphertext', size_in_bits: 253 });
  const u = bits => ({ type: `u${bits}`, size_in_bits: bits });
  const array = content => ({ type: 'array', content });
  const states = () => array(Array.from({ length: 4 }, ct));
  const commitment = () => array(Array.from({ length: 32 }, () => u(8)));
  const key = { type: 'arcis_x25519_pubkey' }, bool = { type: 'bool' };
  assert(['runtime_policy_init', 'runtime_policy_evaluate'].includes(iface.name), 'Unsupported policy circuit name');
  const expected = iface.name === 'runtime_policy_init'
    ? { name: iface.name, inputs: [key, u(128), states(), u(128)], outputs: [bool, states()] }
    : { name: iface.name, inputs: [key, u(128), ct(), ct(), u(128), states(), u(128), commitment()], outputs: [commitment(), bool, states()] };
  assert.deepEqual(iface, expected, 'Unsupported policy circuit interface or cipher domain');
  // Match arcium-macros0.15.0 utils.rs flattening. The on-chain enum erases
  // ciphertext bit width, so the validated artifact interface retains that check.
  const flatten = value => value.type === 'array' ? value.content.flatMap(flatten) : [{
    [value.type === 'ciphertext' ? 'ciphertext' : value.type === 'arcis_x25519_pubkey' ? 'arcisX25519Pubkey'
      : value.type === 'bool' ? 'plaintextBool' : `plaintextU${value.size_in_bits}`]: {},
  }];
  return { name: iface.name, signature: { parameters: iface.inputs.flatMap(flatten), outputs: iface.outputs.flatMap(flatten) } };
}

/** Compare actual pinned Arcium account bytes from one confirmed bank with the
 * selected circuit artifact. This is RPC evidence, not a consensus-state proof. */
export async function verifyUploadedCircuit({ connection, ar, arcium, definition, payer, bytes, interfaceBytes }) {
  assert.equal(address(arcium.programId), ARCIUM_PROGRAM, 'Unsupported Arcium program');
  bytes = Buffer.from(bytes); interfaceBytes = Buffer.from(interfaceBytes);
  assert(bytes.length > 0 && bytes.length <= MAX_PAYLOAD * 256, 'Invalid raw circuit size');
  const { name, signature } = expectedSignature(interfaceBytes);
  const count = Math.ceil(bytes.length / MAX_PAYLOAD);
  const keys = Array.from({ length: count }, (_, index) => ar.getRawCircuitAccAddress(definition, index));
  // Current bounded artifacts use one raw account. Keep one coherent read and
  // reject shapes beyond Solana's single-request account limit explicitly.
  assert(keys.length < 100, 'Circuit too large for one coherent verification read');
  const snapshot = await connection.getMultipleAccountsInfoAndContext([definition, ...keys], { commitment: 'confirmed' });
  assert(Number.isSafeInteger(snapshot.context.slot) && snapshot.context.slot >= 0, 'Missing circuit verification context slot');
  assert.equal(snapshot.value.length, keys.length + 1, 'Incomplete circuit verification response');
  const checkAccount = (account, discriminator) => {
    assert(account && !account.executable, 'Missing or executable circuit account');
    assert.equal(address(account.owner), ARCIUM_PROGRAM, 'Wrong circuit account owner');
    assert.deepEqual(account.data.subarray(0, 8), discriminator, 'Wrong circuit account discriminator');
  };
  const [definitionAccount, ...raw] = snapshot.value;
  checkAccount(definitionAccount, DEFINITION_DISCRIMINATOR);
  const decoded = arcium.coder.accounts.decode('computationDefinitionAccount', definitionAccount.data);
  assert.equal(decoded.deactivationSlot, null, 'Computation definition is deactivated');
  assert.deepEqual(Object.keys(decoded.circuitSource), ['onChain'], 'Require an on-chain computation definition');
  const source = decoded.circuitSource.onChain;
  assert(source && Object.keys(source).length === 1 && source[0]?.isCompleted === true, 'Circuit upload is not complete');
  assert.equal(address(source[0].uploadAuth), address(payer), 'Circuit upload authority mismatch');
  assert.equal(decoded.definition.circuitLen, bytes.length, 'Registered circuit length mismatch');
  assert.deepEqual(decoded.definition.signature, signature, 'Registered computation interface mismatch');
  let consumed = 0;
  const record = (account, key) => ({ address: address(key), owner: address(account.owner), executable: account.executable,
    dataBase64: account.data.toString('base64'), dataSha256: digest(account.data), dataLength: account.data.length });
  const parts = raw.map((account, index) => {
    checkAccount(account, RAW_DISCRIMINATOR);
    const length = Math.min(MAX_PAYLOAD, bytes.length - consumed);
    assert(account.data.length >= HEADER + length, 'Truncated raw circuit account');
    const part = account.data.subarray(HEADER, HEADER + length); consumed += length;
    return part;
  });
  const uploaded = Buffer.concat(parts);
  assert.equal(consumed, bytes.length, 'Incomplete raw circuit payload');
  assert(uploaded.equals(bytes), 'Uploaded circuit bytes differ from selected release');
  return { schema: 1, qualification: 'confirmed-rpc-circuit-byte-comparison', contextSlot: snapshot.context.slot,
    circuit: name, circuitLength: bytes.length, circuitSha256: digest(bytes), uploadedCircuitSha256: digest(uploaded),
    interfaceSha256: digest(interfaceBytes), registeredSignature: signature, onChainCompleted: true, deactivationSlot: null,
    registeredComputationUnits: decoded.cuAmount.toString(),
    uploadAuthority: address(payer), definition: record(definitionAccount, definition), rawAccounts: raw.map((account, index) => record(account, keys[index])) };
}
