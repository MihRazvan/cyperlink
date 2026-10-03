import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPrivateRun, ensure, loadSigner, loadWeb3, LocalSession, saveSigner, writeNew, TOKEN_PROGRAM, loopbackEndpoint } from './runtime.mjs';
const execute = promisify(execFile);

/** Read current native source state and generate a NEW operation's native proofs. */
export async function prepareNativeTransfer({ directory, provisionedDirectory, amount, endpoint = 'http://127.0.0.1:8899', moduleRoot, proofCli, payerKeyfile, ownerKeyfile }) {
  loopbackEndpoint(endpoint);
  ensure(Number.isSafeInteger(amount) && amount > 0 && amount < 2 ** 48, 'Amount must be a positive exact integer below 2^48');
  const web3 = await loadWeb3(moduleRoot), provisioned = JSON.parse(await readFile(resolve(provisionedDirectory, 'provisioned.json'), 'utf8'));
  ensure(provisioned.evidence_level === 'real-local-validator-signed-native-provisioning', 'Expected real local provisioning record');
  ensure(loopbackEndpoint(provisioned.rpc) === loopbackEndpoint(endpoint), 'Provisioning record belongs to a different endpoint');
  const payer = await loadSigner(payerKeyfile, web3), output = await createPrivateRun(directory);
  const session = new LocalSession({ web3, endpoint, payer, directory: output }); await session.assertLocalVersions();
  const owner = await loadSigner(ownerKeyfile ?? resolve(provisionedDirectory, 'source-owner-signer.json'), web3);
  ensure(owner.publicKey.toBase58() === provisioned.source_owner, 'Persisted source owner differs from provisioning record');
  const snapshot = await session.snapshot(new web3.PublicKey(provisioned.accounts.source.address), 'current-source-account.bin');
  ensure(snapshot.owner === TOKEN_PROGRAM, 'Current source has wrong native owner');
  const contextSigners = {};
  for (const name of ['equality', 'grouped', 'range']) {
    contextSigners[name] = web3.Keypair.generate(); await saveSigner(resolve(output, `${name}-context-signer.json`), contextSigners[name]);
  }
  const request = { source: provisioned.accounts.source.address, mint: provisioned.accounts.mint.address,
    destination: provisioned.accounts.destination.address, owner: provisioned.source_owner, amount,
    destination_elgamal_pubkey: provisioned.destination_elgamal_pubkey,
    ...Object.fromEntries(Object.entries(contextSigners).map(([name, signer]) => [name, signer.publicKey.toBase58()])) };
  await writeNew(resolve(output, 'request.json'), JSON.stringify(request, null, 2));
  await execute(resolve(proofCli), ['prepare-transfer', '--keys', resolve(provisionedDirectory, 'source-confidential.bin'),
    '--request', resolve(output, 'request.json'), '--source-account', resolve(output, 'current-source-account.bin'),
    '--output', resolve(output, 'prepared-transfer.json'), '--witness', resolve(output, 'operation-witness.json')], { maxBuffer: 1024 * 1024 });
  const prepared = JSON.parse(await readFile(resolve(output, 'prepared-transfer.json'), 'utf8'));
  ensure(prepared.source_data_sha256 === snapshot.sha256, 'Prepared proof references a different source snapshot');
  return { directory: output, snapshot, prepared, contextSigners, session };
}
