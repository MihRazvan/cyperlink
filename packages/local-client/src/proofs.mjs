import { ensure, instructionFromJSON, PROOF_PROGRAM, saveSigner } from './runtime.mjs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

/** Genuine native proof verification. Context data is written only by the proof program. */
export async function verifyPreparedProof(session, proof, contextSigner, { bufferSigner, bufferProgram } = {}) {
  const { web3 } = session;
  ensure(contextSigner.publicKey.toBase58() === proof.context_address, 'Proof context signer/address mismatch');
  ensure(proof.verify_instruction.program === PROOF_PROGRAM, 'Unexpected proof verification program');
  const inline = instructionFromJSON(proof.verify_instruction, web3);
  const raw = Buffer.from(proof.proof_data, 'hex');
  ensure(inline.data.subarray(1).equals(raw) && inline.keys.length === 2 && inline.keys[0].pubkey.equals(contextSigner.publicKey), 'Malformed prepared native proof');
  await session.createAccount(contextSigner, proof.context_account_size, PROOF_PROGRAM, [], [], `create-proof-${proof.name ?? 'pubkey'}`);
  if (raw.length <= 800) return session.send(`verify-proof-${proof.name ?? 'pubkey'}`, [inline]);
  ensure(bufferSigner && bufferProgram, 'Large native proof requires a signed upload buffer');
  ensure(raw.length <= 16384, 'Proof exceeds local upload limit');
  await session.createAccount(bufferSigner, raw.length, bufferProgram, [], [], 'create-proof-buffer');
  for (let offset = 0; offset < raw.length; offset += 700) {
    const prefix = Buffer.alloc(5); prefix.writeUInt32LE(offset, 1);
    const write = new web3.TransactionInstruction({ programId: new web3.PublicKey(bufferProgram),
      keys: [{ pubkey: bufferSigner.publicKey, isSigner: true, isWritable: true }], data: Buffer.concat([prefix, raw.subarray(offset, offset + 700)]) });
    await session.send(`upload-proof-${offset}`, [write], [bufferSigner]);
  }
  const uploaded = await session.connection.getAccountInfo(bufferSigner.publicKey, 'confirmed');
  ensure(uploaded?.owner.toBase58() === bufferProgram && uploaded.data.equals(raw), 'Uploaded proof buffer differs from prepared proof bytes');
  // Exact upstream solana-zk-elgamal-proof-interface 0.1.3 from-account wire format:
  // proof discriminant + u32 LE offset; [proof buffer, context, context authority].
  const data = Buffer.alloc(5); data[0] = inline.data[0];
  const fromAccount = new web3.TransactionInstruction({ programId: inline.programId, data,
    keys: [{ pubkey: bufferSigner.publicKey, isSigner: false, isWritable: false }, ...inline.keys] });
  const verified = await session.send(`verify-proof-${proof.name ?? 'range'}`, [fromAccount]);
  const close = new web3.TransactionInstruction({ programId: new web3.PublicKey(bufferProgram), data: Buffer.from([1]),
    keys: [{ pubkey: bufferSigner.publicKey, isSigner: true, isWritable: true }, { pubkey: session.payer.publicKey, isSigner: false, isWritable: true }] });
  await session.send('close-proof-buffer', [close], [bufferSigner]);
  return verified;
}

export async function verifyTransferProofs(session, prepared, contextSigners, { bufferProgram } = {}) {
  ensure(prepared.native_verification_required === true && prepared.proofs?.length === 3, 'Expected genuine unverified three-proof transfer preparation');
  const source = await session.connection.getAccountInfo(new session.web3.PublicKey(prepared.source), 'confirmed');
  ensure(source && createHash('sha256').update(source.data).digest('hex') === prepared.source_data_sha256, 'Native source changed since proof preparation; request explicit fresh recomputation');
  const evidence = [];
  for (const proof of prepared.proofs) {
    const signer = contextSigners[proof.name]; ensure(signer, `Missing context signer ${proof.name}`);
    let bufferSigner;
    if (Buffer.from(proof.proof_data, 'hex').length > 800) {
      bufferSigner = session.web3.Keypair.generate();
      await saveSigner(resolve(session.directory, `${proof.name}-buffer-signer.json`), bufferSigner);
    }
    evidence.push(await verifyPreparedProof(session, proof, signer, { bufferSigner, bufferProgram }));
  }
  return evidence;
}
