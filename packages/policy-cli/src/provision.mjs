import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensure, createPrivateRun, loadWeb3, loadSigner, saveSigner, writeNew, instructionFromJSON, LocalSession, TOKEN_PROGRAM, PROOF_PROGRAM } from '../../local-client/src/runtime.mjs';
import { verifyPreparedProof } from '../../local-client/src/proofs.mjs';
import { validateSyntheticMint } from '../../local-client/src/mint-profile.mjs';
const execute = promisify(execFile);

/** Fresh synthetic native assets, all created through signed local transactions. */
export async function provision({ directory, endpoint = 'http://127.0.0.1:8899', moduleRoot, proofCli, payerKeyfile, existingMint, hookProgram }) {
  const web3 = await loadWeb3(moduleRoot);
  // Endpoint guard runs before creating or reading any client secrets.
  const { loopbackEndpoint } = await import('../../local-client/src/runtime.mjs'); loopbackEndpoint(endpoint);
  const output = await createPrivateRun(directory);
  const payer = await loadSigner(payerKeyfile, web3);
  const session = new LocalSession({ web3, endpoint, payer, directory: output });
  const version = await session.assertLocalVersions();
  const signers = {};
  ensure(hookProgram, 'Custom policy provisioning requires its explicit hook');
  const hook = new web3.PublicKey(hookProgram).toBase58();
  if (existingMint) validateSyntheticMint(await session.connection.getAccountInfo(new web3.PublicKey(existingMint), 'confirmed'), payer.publicKey, hook, web3);
  for (const name of ['mint', 'source', 'destination', 'source-owner', 'destination-owner', 'source-pubkey-context', 'destination-pubkey-context']) {
    if (name === 'mint' && existingMint) continue;
    signers[name] = web3.Keypair.generate(); await saveSigner(resolve(output, `${name}-signer.json`), signers[name]);
  }
  const mintAddress = existingMint ? new web3.PublicKey(existingMint) : signers.mint.publicKey;
  const plans = {};
  for (const label of ['source', 'destination']) {
    const keys = resolve(output, `${label}-confidential.bin`), request = resolve(output, `${label}-request.json`), planPath = resolve(output, `${label}-plan.json`);
    // No reusable key material is returned by this command. Public key metadata only.
    await execute(resolve(proofCli), ['create-keys', '--keys', keys], { maxBuffer: 1024 * 1024 });
    await writeNew(request, JSON.stringify({ source: signers[label].publicKey.toBase58(), mint: mintAddress.toBase58(),
      owner: signers[`${label}-owner`].publicKey.toBase58(), pubkey_context: signers[`${label}-pubkey-context`].publicKey.toBase58(),
      mint_authority: payer.publicKey.toBase58(), hook_program: hook, initial_amount: label === 'source' ? 100 : 0, decimals: 0, max_pending_credits: 100 }, null, 2));
    await execute(resolve(proofCli), ['provision-plan', '--keys', keys, '--request', request, '--output', planPath], { maxBuffer: 1024 * 1024 });
    plans[label] = JSON.parse(await readFile(planPath, 'utf8'));
    ensure(plans[label].token_program === TOKEN_PROGRAM && plans[label].proof_program === PROOF_PROGRAM, 'Unexpected native programs in provisioning plan');
  }
  const instructions = list => list.map(raw => instructionFromJSON(raw, web3));
  if (!existingMint) await session.createAccount(signers.mint, plans.source.account_sizes.mint, TOKEN_PROGRAM,
    instructions(plans.source.mint_initialization), [], 'create-initialize-mint');
  for (const label of ['source', 'destination']) {
    const plan = plans[label], owner = signers[`${label}-owner`];
    await session.createAccount(signers[label], plan.account_sizes.token, TOKEN_PROGRAM,
      [instructionFromJSON(plan.token_initialization, web3)], [], `create-initialize-${label}`);
    await verifyPreparedProof(session, plan.configuration, signers[`${label}-pubkey-context`]);
    await session.send(`configure-${label}`, [instructionFromJSON(plan.configuration.configure_instruction, web3)], [owner]);
    if (plan.funding.length) await session.send(`fund-${label}`, instructions(plan.funding), [owner]);
  }
  const accounts = {};
  for (const name of ['mint', 'source', 'destination']) accounts[name] = await session.snapshot(name === 'mint' ? mintAddress : signers[name].publicKey, `${name}-account.bin`);
  const result = { schema_version: 1, evidence_level: 'real-local-validator-signed-native-provisioning', rpc: session.endpoint, validator: version,
    classification: 'synthetic-public-test-setup; plaintext initial funding is test-observer disclosure', initial_amount: 100,
    accounts, reused_mint: Boolean(existingMint), mint_authority: payer.publicKey.toBase58(), source_owner: signers['source-owner'].publicKey.toBase58(), destination_owner: signers['destination-owner'].publicKey.toBase58(),
    source_elgamal_pubkey: plans.source.configuration.elgamal_pubkey, destination_elgamal_pubkey: plans.destination.configuration.elgamal_pubkey,
    limitations: ['No MPC computation or private payment has been executed by this provisioning command',
      'Hook metadata initialization is a separate signed policy operation', 'Quota/MXE/program setup is still the isolated local runtime profile'] };
  await writeNew(resolve(output, 'provisioned.json'), JSON.stringify(result, null, 2));
  return result;
}
