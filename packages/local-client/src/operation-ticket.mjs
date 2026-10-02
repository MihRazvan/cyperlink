import assert from 'node:assert/strict';
import { createHash, verify } from 'node:crypto';
import { ensure, instructionFromJSON, TOKEN_PROGRAM } from './runtime.mjs';
import { descriptorDigest, hexBytes, le, validateOperationPlan } from './operation-plan.mjs';
import { INITIAL_PROFILE as P, validateOperation } from '../../sdk/src/index.mjs';
import { readPreparedActionEvidence } from './prepared-action.mjs';

const sha = value => createHash('sha256').update(value).digest();
export function instructionJSON(instruction) {
  return { program: instruction.programId.toBase58(), accounts: instruction.keys.map(meta => ({ key: meta.pubkey.toBase58(), signer: meta.isSigner, writable: meta.isWritable })), data: Buffer.from(instruction.data).toString('hex') };
}

/** Check retained instruction bytes against native/action/query fields, without an RPC response supplying intent. */
export function expectedOperationInstruction(plan, role, web3) {
  validateOperationPlan(plan);
  ensure(['query', 'commit'].includes(role), 'Unsupported operation ticket role');
  const expected = plan.instructions?.[role];
  ensure(expected, 'Persisted operation instruction is missing');
  const instruction = instructionFromJSON(expected, web3), { descriptor: d, query: q } = plan;
  const { template: t } = validateOperation(d), { PublicKey } = web3;
  const H = new PublicKey(P.policy), G = new PublicKey(Buffer.alloc(32, 81));
  const pda = (seeds, program) => PublicKey.findProgramAddressSync(seeds, new PublicKey(program))[0].toBase58();
  const metadata = pda([Buffer.from('extra-account-metas'), new PublicKey(t.mint).toBuffer()], H);
  let data, addresses;
  if (role === 'query') {
    ensure(expected.program === P.auth && expected.accounts.length === 28, 'Unexpected retained query program/accounts');
    data = Buffer.concat([sha('global:runtime_budget_bound').subarray(0, 8), le(q.offset), hexBytes(q.publicKeyHex, 32, 'public key'),
      hexBytes(q.clientNonceHex, 16, 'client nonce'), hexBytes(q.amountCiphertextHex, 32, 'amount ciphertext'),
      hexBytes(q.openingCiphertextHex, 32, 'opening ciphertext'), le(q.expiry), hexBytes(d.queryStateHashHex, 32, 'query state')]);
    const identities = { 0: pda([Buffer.from('permit-claim'), new PublicKey(d.permit).toBuffer()], P.auth),
      1: d.job, 2: d.quota, 3: P.policy, 4: pda([Buffer.from('admission')], P.auth), 5: d.owner, 6: plan.action, 7: d.permit, 8: d.admin,
      13: d.computation, 20: t.source, 21: t.mint, 22: t.destination, 23: plan.binding.proofAddresses[0],
      24: plan.binding.proofAddresses[1], 25: plan.binding.proofAddresses[2], 26: t.consumer, 27: metadata };
    for (const [index, address] of Object.entries(identities)) ensure(expected.accounts[index].key === address, `Retained query account ${index} differs from intent`);
  } else {
    ensure(expected.program === t.consumer, 'Unexpected retained consumer program');
    const prefix = d.consumerKind === 'merchant' ? [Buffer.from([1]), le(d.sku), Buffer.from([0])]
      : [Buffer.from([2]), hexBytes(d.productHex32, 32, 'product'), le(d.licenseExpirySlot), Buffer.from([0])];
    data = Buffer.concat([...prefix, hexBytes(plan.binding.nativeDataHex, undefined, 'native instruction')]);
    addresses = [d.permit, d.quota, pda([Buffer.from('guard')], G), P.policy, TOKEN_PROGRAM, t.source, t.mint, t.destination,
      ...plan.binding.proofAddresses, d.owner, metadata, t.consumer, pda([Buffer.from('cyperlink-action'), Buffer.from(t.actionDigest)], t.consumer), G.toBase58(), d.effect];
    assert.deepEqual(expected.accounts.map(meta => meta.key), addresses, 'Retained commit accounts differ from intent');
  }
  ensure(Buffer.from(instruction.data).equals(data), 'Retained instruction bytes differ from operation semantics');
  const writable = role === 'query' ? [0, 1, 2, 7, 8, 9, 11, 12, 13, 15, 16, 17] : [0, 1, 5, 7, 16];
  const signers = role === 'query' ? [5, 8] : [11];
  expected.accounts.forEach((meta, index) => ensure(meta.signer === signers.includes(index) && meta.writable === writable.includes(index), 'Retained instruction privilege differs from supported ABI'));
  return instruction;
}

/** Verify existing signed bytes, live ALT resolution, and exact retained operation instruction before any send. */
export async function validateOperationTicket(plan, record, web3, connection) {
  ensure(record.genesisHash === plan.genesisHash && record.descriptorSha256 === descriptorDigest(plan.descriptor), 'Signed record operation identity mismatch');
  const expected = expectedOperationInstruction(plan, record.role, web3);
  const wire = Buffer.from(record.wireBase64, 'base64');
  ensure(wire.toString('base64') === record.wireBase64 && wire.length <= 1232 && sha(wire).toString('hex') === record.wireSha256, 'Signed operation wire integrity mismatch');
  const transaction = web3.VersionedTransaction.deserialize(wire), message = transaction.message;
  ensure(transaction.version === 0 && Buffer.from(transaction.serialize()).equals(wire), 'Expected canonical V0 operation transaction');
  ensure(message.staticAccountKeys[0].toBase58() === plan.descriptor.admin, 'Operation fee payer differs from retained administrator');
  ensure(transaction.signatures.length === message.header.numRequiredSignatures, 'Unexpected operation signature count');
  const expectedSigners = [...new Set([plan.descriptor.admin, ...expected.keys.filter(meta => meta.isSigner).map(meta => meta.pubkey.toBase58())])].sort();
  assert.deepEqual(message.staticAccountKeys.slice(0, message.header.numRequiredSignatures).map(key => key.toBase58()).sort(), expectedSigners, 'Signed operation signer set differs from retained intent');
  for (let i = 0; i < transaction.signatures.length; i++) {
    const key = Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), message.staticAccountKeys[i].toBuffer()]);
    ensure(verify(null, message.serialize(), { key, format: 'der', type: 'spki' }, transaction.signatures[i]), 'Invalid signed operation signature');
  }
  const resolved = { writable: [], readonly: [] };
  for (const lookup of message.addressTableLookups) {
    const response = await connection.getAddressLookupTable(lookup.accountKey, { commitment: 'confirmed', minContextSlot: record.minContextSlot });
    ensure(response.value && response.context.slot >= record.minContextSlot && response.value.key.equals(lookup.accountKey), 'Operation lookup table unavailable at retained context');
    for (const [indices, destination] of [[lookup.writableIndexes, resolved.writable], [lookup.readonlyIndexes, resolved.readonly]]) {
      for (const index of indices) { ensure(response.value.state.addresses[index], 'Operation lookup table index missing'); destination.push(response.value.state.addresses[index]); }
    }
  }
  assert.deepEqual({ writable: resolved.writable.map(key => key.toBase58()), readonly: resolved.readonly.map(key => key.toBase58()) }, record.loadedAddresses, 'Live ALT resolution differs from signed journal');
  const decoded = web3.TransactionMessage.decompile(message, { accountKeysFromLookups: resolved });
  ensure(decoded.instructions.length === 2, 'Operation ticket must contain only compute limit and one retained instruction');
  const budget = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1300000 });
  assert.deepEqual(instructionJSON(decoded.instructions[0]), instructionJSON(budget), 'Unexpected operation compute budget instruction');
  // A message merges privileges for repeated keys and its fee payer. Reproduce that merge,
  // rather than assuming every decoded meta retains the pre-compilation privilege flags.
  const merged = new Map([[plan.descriptor.admin, { signer: true, writable: true }]]);
  for (const meta of expected.keys) {
    const key = meta.pubkey.toBase58(), previous = merged.get(key) ?? { signer: false, writable: false };
    merged.set(key, { signer: previous.signer || meta.isSigner, writable: previous.writable || meta.isWritable });
  }
  const expectedJSON = instructionJSON(expected);
  expectedJSON.accounts = expectedJSON.accounts.map(meta => ({ key: meta.key, ...merged.get(meta.key) }));
  assert.deepEqual(instructionJSON(decoded.instructions[1]), expectedJSON, 'Signed operation instruction differs from retained intent');
  const allowed = new Set([plan.descriptor.admin, budget.programId.toBase58(), expected.programId.toBase58(), ...expected.keys.map(meta => meta.pubkey.toBase58())]);
  const keys = message.getAccountKeys({ accountKeysFromLookups: resolved });
  for (let i = 0; i < keys.length; i++) ensure(allowed.has(keys.get(i).toBase58()), 'Unexpected account in signed operation message');
  const preparedAction = record.role === 'query' ? await readPreparedActionEvidence(plan, web3, connection, { minContextSlot: record.minContextSlot }) : undefined;
  return { ...(preparedAction ? { preparedAction } : {}), role: record.role, wireSha256: record.wireSha256, descriptorSha256: record.descriptorSha256, instructionSha256: sha(Buffer.from(expected.data)).toString('hex'), liveLookupTablesChecked: message.addressTableLookups.length };
}
