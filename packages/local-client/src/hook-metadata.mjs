import { ensure } from './runtime.mjs';
import { validateSyntheticMint } from './mint-profile.mjs';

export function hookMetadataAddress(web3, mint) {
  const hook = new web3.PublicKey(Buffer.alloc(32, 82));
  return web3.PublicKey.findProgramAddressSync([Buffer.from('extra-account-metas'), new web3.PublicKey(mint).toBuffer()], hook)[0];
}

/** H creates and writes its canonical metadata PDA; the client supplies no account bytes. */
export async function initializeHookMetadata(session, mint) {
  const { web3 } = session, mintAddress = new web3.PublicKey(mint), hook = new web3.PublicKey(Buffer.alloc(32, 82));
  validateSyntheticMint(await session.connection.getAccountInfo(mintAddress, 'confirmed'), session.payer.publicKey, hook, web3);
  const metadata = hookMetadataAddress(web3, mintAddress);
  ensure(!(await session.connection.getAccountInfo(metadata, 'confirmed')), 'Hook metadata already exists; initialization is create-only');
  const instruction = new web3.TransactionInstruction({ programId: hook, data: Buffer.from([7]), keys: [
    { pubkey: mintAddress, isSigner: false, isWritable: false },
    { pubkey: metadata, isSigner: false, isWritable: true },
    { pubkey: session.payer.publicKey, isSigner: true, isWritable: true },
    { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false },
  ] });
  const evidence = await session.send('initialize-hook-metadata', [instruction]);
  const account = await session.connection.getAccountInfo(metadata, 'confirmed');
  ensure(account && account.owner.equals(hook) && !account.executable, 'Initialized hook metadata has wrong owner');
  return { address: metadata.toBase58(), evidence };
}
