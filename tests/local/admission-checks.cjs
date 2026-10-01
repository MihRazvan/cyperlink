// Real local-validator negative cases. Proof contexts were populated by genuine
// signed native ZK verification transactions earlier in the replay, never injected.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

module.exports = async function admissionChecks({program, connection, admin, native, send, accounts, pk, cipher, bn, evidence, save}) {
  const {PublicKey} = native.web3;
  const BN = require('bn.js');
  const sha = (...parts) => crypto.createHash('sha256').update(Buffer.concat(parts)).digest();
  const a = native.loadFixture('a'), b = native.loadFixture('b');
  const owner = native.getOwner('a');
  const keysA = a.native_instruction.accounts.slice(0, 6).map(x => new PublicKey(x.key));
  const keysB = b.native_instruction.accounts.slice(0, 6).map(x => new PublicKey(x.key));
  const cases = [
    {name: 'individually verified equality from another transfer', replace: [3, keysB[3]]},
    {name: 'individually verified range from another transfer', replace: [5, keysB[5]]},
    {name: 'equality context substituted for grouped type', replace: [4, keysA[3]]},
    {name: 'non-ZK account substituted for range context', replace: [5, new PublicKey(a.destination)]},
    {name: 'token account substituted for mint with rehashed action', replace: [1, keysB[0]]},
    {name: 'different destination with rehashed immutable action', replace: [2, keysB[2]]},
    {name: 'unsupported native instruction with matching action hash', opcode: true},
    {name: 'inline proof offsets in context-only profile', offset: true},
    {name: 'wrong post-transfer source ciphertext in template', successor: true},
  ];
  evidence.admissionChecks = [];
  for (const test of cases) {
    const keys = [...keysA];
    if (test.replace) {
      assert(!keys[test.replace[0]].equals(test.replace[1]), 'test must actually substitute a different account');
      keys[test.replace[0]] = test.replace[1];
    }
    const data = Buffer.from(a.native_instruction.data, 'hex');
    if (test.opcode) data[1] = 0xff;
    if (test.offset) data[data.length - 1] = 1;
    const template = Buffer.from(a.template464_hex, 'hex');
    // Deliberately recompute every public binding to reach semantic validation.
    for (const [index, offset] of [[0, 80], [1, 112], [2, 144]]) keys[index].toBuffer().copy(template, offset);
    const infos = await connection.getMultipleAccountsInfo(keys, 'confirmed');
    assert(infos.every(Boolean));
    sha(infos[0].data).copy(template, 208);
    sha(data, ...keys.map(k => k.toBuffer()), owner.publicKey.toBuffer(), ...infos.slice(3).map(i => i.data)).copy(template, 240);
    if (test.successor) template[272] ^= 1;
    const id = new BN(crypto.randomBytes(8), 'le');
    const action = PublicKey.findProgramAddressSync([Buffer.from('action'), owner.publicKey.toBuffer(), id.toArrayLike(Buffer, 'le', 8)], program.programId)[0];
    await send([await program.methods.prepareAction(id, template, data).accounts({payer: admin.publicKey, sourceOwner: owner.publicKey, action}).instruction()], [owner], test.name + ' prepare');
    const offset = new BN(crypto.randomBytes(8), 'le');
    const nonce = crypto.randomBytes(16);
    // A legitimate encrypted witness; these cases target public admission, not
    // the separate circuit's wrong-amount/opening gate.
    let opening = 0n;
    for (const byte of [...a.native_input.opening].reverse()) opening = (opening << 8n) + BigInt(byte);
    const ct = cipher.encrypt([60n, opening], nonce);
    const permit = new PublicKey(a.permit);
    const acc = {...accounts('runtime_budget_bound', offset), sourceOwner: owner.publicKey, action, permit,
      permitClaim: PublicKey.findProgramAddressSync([Buffer.from('permit-claim'), permit.toBuffer()], program.programId)[0]};
    const remaining = [...keys, new PublicKey(a.consumer)].map(pubkey => ({pubkey, isSigner: false, isWritable: false}));
    const ix = await program.methods.runtimeBudgetBound(offset, pk, bn(nonce), Array.from(ct[0]), Array.from(ct[1]), new BN((await connection.getSlot()) + 1800))
      .accountsPartial(acc).remainingAccounts(remaining).instruction();
    const before = await connection.getMultipleAccountsInfo([native.QUOTA, permit], 'confirmed');
    const signature = await send([ix], [owner], test.name + ' rejected before private evaluation', true);
    const result = evidence.transactions.at(-1);
    assert.equal(result.error.InstructionError[1].Custom, 6000, test.name);
    const after = await connection.getMultipleAccountsInfo([native.QUOTA, permit], 'confirmed');
    assert(before.every((info, i) => info.data.equals(after[i].data)), 'no quota allocation or permit mutation');
    for (const key of [acc.job, acc.permitClaim, acc.computationAccount]) {
      assert.equal(await connection.getAccountInfo(key, 'confirmed'), null, 'failed queue must not create authority or computation');
    }
    evidence.admissionChecks.push({name: test.name, signature, nativeProofs: 'genuinely verified earlier on this ledger', publicBindingsRecomputed: true, noComputationCreated: true, quotaAndPermitUnchanged: true});
    save();
  }
};
