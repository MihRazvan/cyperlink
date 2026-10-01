# Local client provisioning

This package creates fresh synthetic native confidential-token accounts through real signed local transactions. It does not inject initialized account bytes or verified proof contexts into genesis. Reusable ElGamal/AES secrets stay in client-owned binary files; Node orchestration never reads them. The pinned Rust client helper creates and uses those secrets.

Prerequisites: a running isolated Agave 4.3.0 validator with the captured qualified Token-2022 ELF, a funded disposable local payer, `crates/client-proofs/target/debug/cyperlink-client-proofs`, and the existing exact JavaScript installation containing `@solana/web3.js` 1.99.0. Pass that installation's package directory through `--module-root`; nothing is installed or upgraded by these commands. The output must be a fresh path beneath this repository's ignored `.local` directory. Signing keys and generated files use mode0600, the run directory mode0700.

```sh
node packages/local-client/provision.mjs \
  --out .local/provision-native-01 \
  --module-root /path/to/pinned/javascript/package \
  --proof-cli crates/client-proofs/target/debug/cyperlink-client-proofs \
  --payer /path/to/disposable/local-test-wallet.json \
  --rpc http://127.0.0.1:8899
```

The runner performs ten signed transactions: mint creation plus extension/base initialization, source and destination creation/initialization, two proof-context creations, two native pubkey-validity proof verifications, two confidential-account configurations, and source funding through public mintTo100, confidential deposit and apply-pending in one transaction. Source starts with 100 synthetic units, destination with zero; the setup amount is a public test-observer disclosure. Source/destination account decryption keys and ordinary owner signing keys are independently generated and persisted locally.

Each send verifies every signature locally, enforces the native 1232-byte wire limit, runs signature-validating simulation, submits, and retrieves actual landed transaction evidence. A signed wire record is written before submission. The RPC may retransmit those same signed bytes up to five times; it cannot change the message, nonce, keys or authorization. A failed or ambiguous submission does not silently regenerate identities or restart provisioning; preserve the directory and inspect its evidence. Private keys are never printed or committed.

`provisioned.json` contains public account identifiers and snapshot hashes. Hook metadata initialization, policy quota, MXE and program deployments are separate setup steps. Provisioning alone establishes neither private payment nor distributed computation.

Prepare a fresh operation from the current RPC source state using persisted client keys:

```sh
node packages/local-client/prepare-transfer.mjs \
  --out .local/provision-native-01-transfer60 \
  --provisioned .local/provision-native-01 --amount 60 \
  --module-root /path/to/pinned/javascript/package \
  --proof-cli crates/client-proofs/target/debug/cyperlink-client-proofs \
  --payer /path/to/disposable/local-test-wallet.json
```

This reads the current source bytes, generates new equality/grouped/range proofs and native transfer data with the pinned upstream cryptography, and stores the operation amount/opening in a private witness file. The Rust helper locally verifies these proofs. They are still unverified by the native on-chain program at this step. New preparation is explicit; nothing automatically recomputes private policy queries.

With the local proof-buffer writer (program key `[89;32]`) loaded and its actual ELF checked, verify the native proofs:

```sh
node packages/local-client/verify-proofs.mjs \
  --prepared .local/provision-native-01-transfer60 \
  --module-root /path/to/pinned/javascript/package \
  --payer /path/to/disposable/local-test-wallet.json
```

`verifyTransferProofs` first rejects a source snapshot that changed after preparation. It creates native proof contexts through signed system instructions, submits small proofs inline, and uploads the range proof into a fresh buffer through owner-signed writes. The uploaded bytes are compared with the prepared proof before the official proof-account verification instruction reads them. The buffer is closed and rent refunded only after successful native verification. Only the native proof program writes verified context contents. The buffer writer's ABI is opcode0 + offsetu32LE + bytes (buffer account writable signer), and opcode1 for close (buffer writable signer, refund writable). Proof context cleanup is not yet implemented.

The package exports reusable `LocalSession`, `provision`, `prepareNativeTransfer`, `verifyPreparedProof` and `verifyTransferProofs` modules under `src/`; the command-line scripts are thin local orchestration wrappers. It does not sign policy-administrator queries or create authorized permits. Public RPCs, credentials and redirects are rejected.

Validation on 2026-10-01: `.local/provision-native-01` completed ten actual signed transactions at validator slots313–322 using the routing-v2 local ledger; fresh native mint303B/source470B/destination470B snapshots were captured. Transfer60 preparation then succeeded from the live source at slot563 using persisted client keys. This proves the initial native provisioning and client preparation path. Later fresh conflict-v4 and compatible-v5 qualified native transfer execution, range-buffer verification/cleanup, same-mint provisioning, hook metadata and both authenticated consumer paths. See `docs/STATUS.md` and the separate public reports; the earlier provisioning-only run remains a narrower result.

Host tests: `node --test packages/local-client/test/runtime.test.mjs`. Set `CYPERLINK_JS_MODULE_ROOT` if the pinned installation is elsewhere. These seven tests check loopback/path restrictions, secret-file permissions and symlinks, genuine local signature construction with explicitly mocked RPC responses, mismatched landed-message rejection, simulation failure without submission, and buffer upload/verification/close ordering. Mocked orchestration tests are not native validator proof-verification evidence.


For a second independently owned source/destination under the **same** synthetic mint, pass `--mint EXISTING_MINT` to the provisioning command or `existingMint` to `provision()` / `provisionNative()`. The runner skips mint creation, validates its live owner and exact CT+hook extension profile (including the same mint/CT/hook authority, zero decimals, no freeze authority, no auditor and automatic approval), then creates the new accounts and funds the new source100 with the same local mint authority. Unsupported or fee-bearing mints are rejected, including fee extensions at zero basis points. This keeps both consumers' budgets denominated in the same synthetic asset.

Initialize hook metadata once per fresh mint, after deploying and checking the H program with opcode7:

```js
import { initializeHookMetadata } from './packages/local-client/src/index.mjs';
const { address, evidence } = await initializeHookMetadata(session, mintAddress);
```

The helper derives the official `extra-account-metas` PDA and submits H opcode7 with mint, metadata, payer and system accounts. H allocates and writes its canonical routing data; the client never injects metadata bytes. Initialization is create-only. A second provisioning call for the same mint reuses the existing metadata and should not call initialization again. The helper requires the payer to remain the synthetic mint administrator; it does not generalize permissionless metadata creation.

The same-mint flow and canonical metadata initialization passed actual signed transactions in fresh v4/v5 scenarios. Empty nonexecutable System-owned prefunded metadata can be initialized; existing initialized state and wrong ownership/data remain rejected. See `docs/STATUS.md` for loaded-program provenance and evidence.
