# Native confidential delegate rejection

A bounded **local SVM** probe against the exact qualified Token-2022 ELF. It creates fresh SDK7 proofs and verifies them through Mollusk's native proof builtin; no verified contexts are injected. Mint/token accounts are synthetic. Native `Approve` sets an actual delegate. The owner-signer transfer control succeeds, but the approved delegate fails Custom4 (OwnerMismatch), with unchanged accounts. Missing owner signer privilege also fails.

Mollusk provides account signer privileges; this does not verify Ed25519 signatures or establish validator/distributed evidence. The no-hook mint isolates native authority and is not the qualified Approvals mint profile. The keys are fresh in memory and never exported. Public report values100/60 are test-observer disclosures.

From repository root, after the pinned local toolchain is installed:

```sh
mkdir -p .local/permissions-authority-v2
CARGO_TARGET_DIR="$PWD/.local/permissions-authority-build" cargo run \
  --manifest-path experiments/permissions/native-authority/Cargo.toml \
  --bin cyperlink-permissions-native-authority \
  --locked --offline -- \
  .local/toolchain/native/programs/token-2022.so \
  .local/permissions-authority-v2/report.json
```

The output is create-only. ELF SHA256 is checked before execution. The lockfile was seeded from the recorded research `compatibility/deployed-elf/Cargo.lock`; the only newly resolved packages are this local crate and the existing local proof client. No registry version or checksum changed. Mollusk0.13.4 and SDK7.0.1 are exact dependencies; its underlying native builtin is the recorded SVM4 stack, distinct from the real validator's Agave4.3.0 stack.

See [the design and limitations](https://github.com/MihRazvan/cyperlink/blob/builder-exercise-v1/docs/permissions-feasibility.md). This is negative evidence for direct native delegation, not a successful Permissions offering.
