# Isolated Permissions feasibility

Two separate results, preserving the qualified Approvals profile:

1. [Native delegate rejection](native-authority/README.md): pinned native ELF executed in local SVM; genuine proof verification, actual Approve, delegate rejected.
2. [Scoped escrow program](scoped-escrow/src/lib.rs) + [real validator runner](live.mjs): owner grants a fixed recipient/action scope by rotating a dedicated confidential source to its grant PDA. A separate agent then generates fresh proofs and signs its own native confidential execution. The program updates a scoped execution receipt atomically with the transfer. No owner signature is in that execution message.

The native balance is the reserved private capacity. There is **no Arcium computation, separate shared allowance, automatic admin approval, merchant pricing predicate or production integration** here. The same local operator controls the test keys. The executor has only the dedicated escrow's ElGamal/AES keys, not a wallet key. Receipt count means successful scoped native operations; it does not enforce a minimum amount and must not be sold as a priced entitlement.

Passing v3 evidence includes a genuine 100→40 native transfer, exact receipt update,7 signed landed adversarial failures, and owner revocation plus a genuine40 refund using retained dedicated keys. Amounts are synthetic test-observer disclosures. [Public report](evidence/native-escrow-v3.json) contains no private keys or openings. Raw evidence and ledger are ignored under `.local/permissions-escrow-v3`. The verifier checks75 signed wires/125 signatures and retained raw before/after snapshots; it does not establish historical bank-state authenticity or independent MPC verification.

## Reproduce

Requires the repository's previously installed exact native/JS toolchains and built client/proof-buffer. Existing host Cargo/SBF caches are used offline; this is not second-machine qualification. The escrow lock is seeded from the native baseline and introduces no registry version changes. The asset planner shares the existing SDK7 proof client; no cryptography was substituted.

```sh
CARGO_TARGET_DIR="$PWD/.local/permissions-authority-build" cargo build \
  --manifest-path experiments/permissions/native-authority/Cargo.toml --locked --offline --bins
PATH="$HOME/.cargo/bin:$PATH" CARGO_TARGET_DIR="$PWD/.local/permissions-escrow-build" \
  .local/toolchain/native/agave-3.1.14/solana-release/bin/cargo-build-sbf \
  --manifest-path experiments/permissions/scoped-escrow/Cargo.toml \
  --tools-version v1.57 --arch v0 --sbf-out-dir "$PWD/.local/permissions-escrow-elf" \
  --offline -- --locked
node experiments/permissions/live.mjs .local/permissions-escrow-new
node experiments/permissions/verify.mjs .local/permissions-escrow-new \
  .local/permissions-escrow-new/offline-review.json
```

The runner starts one pinned Agave4.3 validator on loopback8979 with faucet9900 and stops it in `finally`; coordinate exclusive access first. Each output directory must be new. It checks the actual three loaded ELF byte arrays before transactions. It waits for a rooted startup bank because early confirmed simulation can precede reliable transaction ingress. Missing delivery is a failure artifact, not permission to re-sign or pretend success. Setup uses the existing LocalSession journal; this experimental script is not the durable production operation API.

The successful program bytes are SHA256 `b7b981b4cdf8085c3587521090b6b70ebe7959d841150e1e3f63a1e033c7e07e`. Any program-source changes require rebuilding and another actual loaded-byte qualification. The source manifest was captured after the run and explicitly is not a reproducible source-to-ELF proof.

## Limits that block general availability

The grant PDA is permanently tied to the source (`["grant", source]`): revoking it does not allow regranting that same source. A new grant requires a new dedicated source. Expiry only blocks execution; an explicit owner revoke is still required to recover native signing authority.

The grant is funded once, denies both incoming credit types, requires no pending balance and immutable mint controls, and admits only an exact no-fee native CT operation. The experiment has one recipient, one semantic action, public expiry/use limit and one dedicated source per grant. It proves an authority construction; it does not add a second product SDK mode.

Revocation races serialize on grant/source and can return native signing authority, including after expiry. Honest refund works. An adversarial executor can corrupt the unauthenticated AES balance cache; refund after that corruption is not qualified. Lost escrow proof keys can still strand funds. Direct grants must not be enabled until an explicit owner backup/recovery mechanism is supported and tested. There is no independent operator or secrecy-from-executor claim.

See [authority, query disclosure and funding semantics](https://github.com/MihRazvan/cyperlink/blob/builder-exercise-v1/docs/permissions-feasibility.md). Additional acceptance tests remain: rollback after a successful token CPI followed by application failure, malicious cache recovery, use-limit exhaustion, wrong executor, and a genuinely useful priced/conditional consumer with exact confidential amount binding. Do not infer these from the receipt-only positive.
