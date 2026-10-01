import { ensure, TOKEN_PROGRAM } from './runtime.mjs';

/** Exact current synthetic mint profile, using Token-2022 interface 3.1.0 layout. */
export function validateSyntheticMint(account, mintAuthority, hookProgram, web3) {
  ensure(account && account.owner.toBase58() === TOKEN_PROGRAM && account.executable === false, 'Existing mint must be a nonexecutable Token-2022 account');
  const data = Buffer.from(account.data), authority = new web3.PublicKey(mintAuthority).toBuffer(), hook = new web3.PublicKey(hookProgram).toBuffer();
  ensure(data.length === 303 && data[165] === 1 && data.subarray(82, 165).every(byte => byte === 0), 'Existing mint has unsupported account layout');
  ensure(data.readUInt32LE(0) === 1 && data.subarray(4, 36).equals(authority), 'Payer must control the existing synthetic mint authority');
  ensure(data[44] === 0 && data[45] === 1 && data.readUInt32LE(46) === 0 && data.subarray(50, 82).every(byte => byte === 0), 'Existing mint must be initialized, zero-decimal and without freeze authority');
  const extensions = new Map();
  for (let offset = 166; offset < data.length;) {
    ensure(offset + 4 <= data.length, 'Truncated mint extension header');
    const type = data.readUInt16LE(offset), length = data.readUInt16LE(offset + 2); offset += 4;
    ensure((type === 4 || type === 14) && !extensions.has(type) && offset + length <= data.length, 'Unsupported, duplicated or truncated mint extension');
    extensions.set(type, data.subarray(offset, offset + length)); offset += length;
  }
  const confidential = extensions.get(4), transferHook = extensions.get(14);
  ensure(confidential?.length === 65 && confidential.subarray(0, 32).equals(authority) && confidential[32] === 1 && confidential.subarray(33).every(byte => byte === 0), 'Existing mint confidential authority, approval or auditor configuration differs from supported profile');
  ensure(transferHook?.length === 64 && transferHook.subarray(0, 32).equals(authority) && transferHook.subarray(32).equals(hook), 'Existing mint hook or hook authority differs from supported profile');
  return { supply: data.readBigUInt64LE(36).toString(), decimals: 0, extensionTypes: [4, 14] };
}
