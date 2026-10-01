# Validation matrix

All results here are synthetic local development evidence. Native amounts and initial allowance are disclosed to the test observer. Account identities, instruction timing and policy decisions are public; this is not an anonymity claim. No public-network transaction, production security review or external integration commitment is represented.

| Layer | Evidence | What it establishes | Limits |
| --- | --- | --- | --- |
| Archived provenance | 46 pinned research artifacts; 14 verifier tests | Exact historical source/artifact correspondence and recorded invariants | No fresh execution |
| Native admission host tests | 12 test groups; six genuine proof payloads reverified | Upstream proof relations, native current funding/arithmetic, account/instruction/profile rejection | Host account/signer scaffolding is not validator authorization |
| Routing host tests | 4 groups using upstream metadata resolution | Canonical route and 161-byte quota layout | Runtime privilege propagation qualified separately |
| Client proof host tests | 4 groups | Persistent client keys; fresh proofs from updated source; local cryptographic verification | Modeled source advancement is not a payment |
| Provisioning host tests | 7 native program tests plus shared helper rejection test | Initializer authority/PDA/state boundaries | Real allocate/assign and rent effects need validator execution |
| JavaScript client | 7 groups | Signed wire verification, exact landed-message checks, profile restrictions, buffer sequencing | RPC responses are mocked in host tests |
| Operation SDK | 15 groups | Exact native/action builders, merchant/license lifecycle, fail-closed partial/forged effects, consistent reads | A trusted RPC/account reader, not a light client |
| Loaded-program verifier | 16 tests | Loader ownership, exact ELF bytes, stable pointer and genesis, trailing padding | Identity check, not a security audit |
| Real validator + two nodes, routing-v2 |[public report](../evidence/2026-10-01/admission-routing-v2.json) | Nine malformed queues rejected before computation; three bad encrypted witnesses denied; paid merchant effect, rollback, stale/replay/cancel rejection | Historical synthetic native genesis assets; pre-canonical-quota deployment |
| Real validator, provisioning-v3 |[public report](../evidence/2026-10-01/provisioning-negatives-v3.json) | Nine signed negative simulations and real buffer write/close/rent refund | Predates prefunding fix; no MPC or payment claim from this test |
| Real validator + two nodes, fresh conflict-v4 |[public report](../evidence/2026-10-01/two-consumers-conflict-v4.json) | Fresh signed provisioning, prefunded PDA recovery, both admissions, merchant payment, stale license, fresh denial, three exact binding failures and atomic rollback | One quota, administrator co-signing, confirmed commitment; remaining 40 is observer-inferred |
| Real validator + two nodes, fresh compatible-v5 |[public report](../evidence/2026-10-01/two-consumers-compatible-v5.json) | Fresh 40+40 computations, both native payments and paid consumer records, quota version 2; independent final account/SDK read | Separate fresh ledger; remaining 20 is observer-inferred; no public-network claim |

The interrupted v1/v3 attempts remain under `.local/` with their exact failures. They are not passing end-to-end evidence. Current results and remaining limitations are recorded in [STATUS.md](STATUS.md).

## Repeatable checks

From the repository root, with the pinned toolchain/cache available:

```sh
python3 scripts/verify_research.py --research-root /Users/razvan/Repos/colosseum
python3 -m unittest discover -s tests -q
cargo test --locked --offline --manifest-path crates/native-admission/Cargo.toml
cargo test --locked --offline --manifest-path crates/hook-routing/Cargo.toml
cargo test --locked --offline --manifest-path crates/client-proofs/Cargo.toml
cargo test --locked --offline --manifest-path crates/pda-provisioning/Cargo.toml
cargo test --locked --offline --manifest-path programs/native/Cargo.toml
node --test packages/sdk/test/*.test.mjs packages/local-client/test/*.test.mjs
```

See [local-replay.md](local-replay.md) for build, fresh validator/runtime setup and actual loaded-ELF verification. Changed program source must be rebuilt and the bytes loaded by that run must match before its results qualify the change.

## Cost boundaries

Final settlement CU and fees exclude native proof verification, account/rent setup, query preparation, Arcium queue/callback transactions and circuit upload. Callback wall time includes local scheduling and observation, not an independent measure of worker computation. The two-node Docker run uses cached AMD64 images on an ARM64 host; public-network latency and throughput cannot be inferred. Worker CPU/network usage, production fee markets and user-scale economics are unmeasured. Keep these categories separate in any demo or business claim.
