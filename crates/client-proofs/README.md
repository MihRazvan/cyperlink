# Client proof lifecycle

This Unix client library/CLI persists a user's reusable ElGamal and AES keys,
prepares real native proofs from current account data, and exports only unsigned
public instructions plus an operation-scoped private witness. It has no RPC or
MPC connection. It never writes an authorized permit or a verified context.

```sh
cargo build --offline --locked --manifest-path crates/client-proofs/Cargo.toml
cargo test --offline --locked --manifest-path crates/client-proofs/Cargo.toml
```

The executable is `crates/client-proofs/target/debug/cyperlink-client-proofs`.
All output paths are create-only. Existing keys, witnesses and manifests are
never replaced. Store private outputs in the ignored local run directory, not
the repository source tree.

## Commands

```sh
cyperlink-client-proofs create-keys --keys /private/client.keys
cyperlink-client-proofs provision-plan --keys /private/client.keys \
  --request setup.json --output setup-plan.json
cyperlink-client-proofs configure-proof --keys /private/client.keys \
  --request configure.json --output configure-plan.json
cyperlink-client-proofs prepare-transfer --keys /private/client.keys \
  --request purchase.json --source-account current-source.bin \
  --output purchase-public.json --witness /private/purchase-witness.json
```

`create-keys` writes an 88-byte versioned binary file (`CYPKEY01`, SDK ElGamal
keypair bytes, AES key bytes) with mode 0600. Loading rejects symlinks, nonregular
files, files owned by another user, or group/other permissions. Stdout contains
only the public ElGamal key and completion status. This file is local plaintext
key storage for the initial developer profile, not hardware-wallet custody or
production backup/recovery. SDK secret types and temporary key byte buffers are
zeroized; account-wide keys never enter the public manifest or operation witness.

`configure-proof` request fields are `source`, `mint`, `owner`, `pubkey_context`
(base58 addresses), and optional `max_pending_credits` (default 100). The output
contains `elgamal_pubkey` (hex), `context_address`, `context_account_size`,
`proof_data` (hex), `verify_instruction`, and `configure_instruction`.

`provision-plan` adds request fields `mint_authority`, `hook_program`,
`initial_amount`, and optional `decimals` (default 0). It returns:

- `account_sizes`: `mint`, `token`, `pubkey_context` byte counts.
- `token_program` and `proof_program`: owners for actual account creation.
- `mint_initialization`: CT extension, hook extension, then InitializeMint2.
- `token_initialization`: InitializeAccount3, which installs required hook state.
- `configuration`: the same pubkey-validity/configuration output described above.
- `funding`: MintTo, confidential Deposit, then ApplyPendingBalance using the
  persisted AES key and expected counter 1. Zero initial amount yields no funding.

The provisioning plan is for fresh synthetic local assets only: CT plus hook,
no fee extension, no auditor, auto-approved confidential accounts, zero decimals
unless specified. It labels the public initial mint/deposit amount as a test
observer disclosure. The submitting client must create and initialize each mint
or token account in the same transaction, verify the pubkey proof natively, then
configure and fund. Plans alone are not evidence that any account exists.

`prepare-transfer` reads raw current Token-2022 source account data. Its request
contains `source`, `mint`, `destination`, `owner`, `equality`, `grouped`, `range`
(addresses), `amount` (unsigned integer), `destination_elgamal_pubkey` (32-byte
hex), and optional `auditor_elgamal_pubkey` (32-byte hex). The three context
addresses are for fresh accounts the submitting client will create and populate
through native verification. The amount must be positive and less than 2^48.

The output contains `source_data_sha256`, `expected_commitment`,
`expected_new_source_ciphertext`, `new_decryptable_available_balance` (all hex),
`native_instruction`, and `proofs` entries with `name`, `context_address`,
`context_account_size`, `proof_data`, `verify_instruction`. Every instruction is
`{program, data: hex, accounts: [{key, signer, writable}]}`. Proof contexts are
**not** emitted as authenticated account state. The range proof instruction is
larger than a transaction; the uploader must use native proof-account transport.

The separate mode-0600 witness contains only `amount`, `opening` (32-byte array),
`commitment` (32-byte array), and the source data hash, plus format labels. Only
operation-scoped amount/opening may go through the client's MPC encryption path.
Keep the witness on the client; the public manifest contains neither value.

After settlement, fetch the actual new source account and prepare again using
the same key file. The client does not advance account state speculatively.
The tests model 100 → 40 → 0 using fresh 60/40 proofs, verify those proofs, reject
41 after the first spend, and reject inconsistent encrypted/decryptable state.
Those host state updates are explicitly models, not claims of native settlement.

## Library API

`ClientKeys::{generate, save_new, load, public_key_hex}`, `configure_proof`,
`provision_plan`, and `prepare_transfer` provide the same functionality without
subprocesses. `PreparedTransfer` separates `public` from `witness`.
`OperationWitness::{amount, opening_bytes}` exposes only operation-scoped input
to an encryption integration; `save_new` persists it privately. Native admission,
owner transaction signatures, hook routing, account permissions and atomic
settlement remain responsibilities of the on-chain path and submitting client.
