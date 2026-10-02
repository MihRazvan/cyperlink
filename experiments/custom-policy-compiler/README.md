# Compiler integration gate

This is **host evidence**, not deployed policy qualification. The pinned JS
cipher test reproduced the research mismatch: RescueCipher and CSplRescueCipher
round-trip their own values but their ciphertexts are not interchangeable.
Pinned Rust `arcis-compiler0.15.0/src/types.rs` defines `ArcisField = BaseField`;
`arcis0.15.0/src/lib.rs` defines its ciphertext as that field. The established
native commitment wrapper instead uses ScalarField. No supported high-level
native bridge or same-secret field conversion was identified. The implementation
therefore uses the documented typed-expression fallback, without changing the
native amount commitment or opening width. This is a bounded integration choice,
not a claim that future compiler integration is impossible.

The maintained implementation is `crates/policy-authoring`. Its tests exercise
47 synthetic vectors against the actual compiler IR, with fresh SDK7 native
Pedersen openings and32 individual commitment-byte corruptions. Four regular
test groups pass; two explicitly invoked artifact tests also pass. Initializer
and evaluator compilation produced real pinned artifacts. Building the same
source into another output path produced byte-identical arcis/hash/idarc/weight
files; a novel multiply/select/reward rule produced a different evaluator.
`results.json` records safe artifact hashes. The native SDK4 dependency within
Arcis remains upstream; commitment expectation tests use SDK7 and never treat
old SDK4 proof output as a valid native proof.

```sh
node experiments/custom-policy-compiler/cipher-domains.mjs .local/toolchain/js
CARGO_TARGET_DIR=.local/circuit-build-target cargo test --locked --offline \
  --manifest-path crates/policy-authoring/Cargo.toml
CYPERLINK_POLICY_BUILD_OUT="$PWD/.local/custom-policy-compiler-v1/build" \
CARGO_TARGET_DIR=.local/circuit-build-target cargo test --locked --offline \
  --manifest-path crates/policy-authoring/Cargo.toml compile_artifacts \
  -- --ignored --nocapture
CYPERLINK_POLICY_BUILD_OUT="$PWD/.local/custom-policy-compiler-v1/build" \
CARGO_TARGET_DIR=.local/circuit-build-target cargo test --locked --offline \
  --manifest-path crates/policy-authoring/Cargo.toml compile_artifact_variants \
  -- --ignored --nocapture
```

Use a new ignored build directory when reproducing. Existing dependency caches
are reused, not a second-machine installation claim. Initializer/evaluator
compiler weights are794133188/1007031150 modeled ACUs for the count policy; the
novel rule evaluator is1135223584. These are not Solana CU, fees or measured
distributed runtime latency. Private test values are synthetic observer inputs;
the production wrapper only emits a Boolean decision, native commitment and
encrypted successor. No raw compiled artifacts or secrets are committed here.
