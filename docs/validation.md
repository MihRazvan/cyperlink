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
| Source circuit rebuild | [byte comparison](../evidence/2026-10-01/circuit-source-rebuild.json); six integrity tests | Both real runtime circuits compile from locked source; all eight artifacts exactly match | Host compilation; separate distributed execution below |
| Repository bootstrap host tests | Seven JS, fourteen native installer, six generator, five preparation groups | Exact locks/hashes, safe extraction, fresh key generation boundaries, isolated pinned services | Existing Rust/SBF caches; Darwin ARM64 qualification only |
| Generated bootstrap + real validator/two nodes, conflict-v6 | [public report](../evidence/2026-10-01/two-consumers-generated-conflict-v6.json) | Rebuilt circuits, new administrator/node identities, both admissions, paid SKU, stale/fresh denial and six adversarial failures; raw snapshots retained | Confirmed local RPC; one host with trusted dealer, not independent operators |
| Generated bootstrap + real validator/two nodes, compatible-v7 | [public report](../evidence/2026-10-01/two-consumers-generated-compatible-v7.json) | Fresh 40+40 paid SKU/license and quota2; independent final SDK reads | Separate fresh ledger; observer-inferred remaining20; host caches remain |


The interrupted v1/v3 attempts remain under `.local/` with their exact failures. They are not passing end-to-end evidence. Current results and remaining limitations are recorded in [STATUS.md](STATUS.md).

## Repeatable checks

The 2026-10-02 SDK continuation adds two final fresh-runtime qualifications:

| Layer | Evidence | Result | Boundary |
| --- | --- | --- | --- |
| Host SDK, durable transport and recovery | 77 Node client/SDK/example/snapshot tests; five recovery archive groups; 80 Python tests; four Auth snapshot tests | Exact signed-wire recovery, bounded broadcast journals, finalized ALT activation, alternate PreparedAction rejection and query snapshot binding | Synthetic host fixtures and mocked RPC remain distinct from execution |
| Real validator + two nodes, compatible-v13 | [Run](../evidence/2026-10-02/two-consumers-sdk-compatible-v13.json), [independent review](../evidence/2026-10-02/independent-sdk-compatible-v13-review.json), [recovery review](../evidence/2026-10-02/sdk-compatible-v13-recovery-review.json) | Both 40 purchases paid; quota2/counter3; nine recovery processes, four tickets; 1,282 Ed25519 signatures and ten loaded ELFs checked | Explicit admin/owner signing; deliberately lost RPC response; local confirmed observations |
| Real validator + two nodes, conflict-v15 | [Run](../evidence/2026-10-02/two-consumers-sdk-conflict-v15.json), [signed archive](../evidence/2026-10-02/independent-sdk-conflict-v15-review.json), [recovery review](../evidence/2026-10-02/sdk-conflict-v15-recovery-review.json) | Actual 6004 rejects counter-only query drift before MPC; paidA, staleB, fresh denial,705/1099/1001; 11 recovery processes, five tickets; 1,350 signatures and ten loaded ELFs checked | New query ABI/ELF; unchanged circuit and native cryptography; 33 original rejection account comparisons plus separate 6004 absence/equality checks |

Recovery archive verification requires the query's retained immutable action
account evidence, its native/consumer template match and the actual signed wire.
It fails closed for older archives that lack that evidence. It does not independently
verify BLS or turn RPC observations into historical state proofs. Preserve the
older verifier revision when examining older qualification levels.

```sh
node scripts/verify_recovery_archive.mjs \
  --results .local/demo-sdk-conflict-v15/results.json \
  --module-root .local/toolchain/js \
  --output .local/new-sdk-conflict-recovery-review.json
node --test tests/recovery-archive.test.mjs
```

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

See [local-bootstrap.md](local-bootstrap.md) for build, fresh validator/runtime setup and actual loaded-ELF verification. The research verifier above is optional historical provenance verification, not required by the new bootstrap. Changed program source must be rebuilt and the bytes loaded by that run must match before its results qualify the change.

## Cost boundaries

Final settlement CU and fees exclude native proof verification, account/rent setup, query preparation, Arcium queue/callback transactions and circuit upload. Callback wall time includes local scheduling and observation, not an independent measure of worker computation. The two-node Docker run uses cached AMD64 images on an ARM64 host; public-network latency and throughput cannot be inferred. Worker CPU/network usage, production fee markets and user-scale economics are unmeasured. Keep these categories separate in any demo or business claim.

## Independent conflict archive review

The [independent review](../evidence/2026-10-01/independent-conflict-v4-review.json) verified 1,323 Ed25519 signatures over 1,267 archived messages, decoded all four callbacks, and matched 85 public critical receipts, ten loaded-ELF reports, 29 compiled source files and 15 executed client files. This is offline archive verification, not a fresh RPC reread or an independent BLS verifier. Historical rollback byte equality was checked by the executed runner; v4 did not retain those raw before/after snapshots for independent rechecking. Compatible-v5 separately retains its final single-bank account snapshot.

Repeat that offline check without starting services (output must be new):

```sh
node scripts/verify_archived_demo.mjs \
  --results .local/demo-conflict-v4/results.json \
  --public-report evidence/2026-10-01/two-consumers-conflict-v4.json \
  --source-manifest .local/replay-consumers-conflict-v4/source-hashes.json \
  --module-root .local/replay-consumers-conflict-v4/research/cyperlink-prebuild-2026-10-01/bound-join/cyperlink_auth \
  --output .local/demo-conflict-v4/new-archive-check.json
```

## Fresh generated bootstrap archives

Generated conflict-v6 and compatible-v7 used independently installed dependencies, source-rebuilt circuits, fresh upstream genesis and fresh administrator/node identities. Both checked ten actually loaded ELFs. Settlement-only CU was 95,557 for conflict-v6's merchant, and 115,057/91,275 for compatible-v7's merchant/license. These are individual local transaction observations, not comparative benchmarks or total operation costs.

The [combined conflict archive review](../evidence/2026-10-01/independent-generated-conflict-v6-review.json) also verifies 1,323 Ed25519 signatures over 1,267 messages, four callbacks, ten ELF hashes and the retained source manifests.

The retained snapshot reviews cover [six rejected transactions and one merchant commit](../evidence/2026-10-01/generated-conflict-v6-snapshots.json) and [both compatible commits](../evidence/2026-10-01/generated-compatible-v7-snapshots.json). Rejections compare 33 tracked accounts across the six before/after pairs, including bytes, owner, executable flag and lamports. The verifier binds tracked addresses to the retained consumer instruction, checks slots bracket the receipt, and verifies exact encrypted successors and paid effects for commits. Seven synthetic corruption-test groups exercise missing/altered accounts, metadata, slots, encodings, successor and consumer effects. These test fixtures are explicitly host-only.

The public exporter allowlists fields recursively and excludes private key/witness files, raw transaction wires and logs. Eight tests cover private-field exclusion, snapshot fidelity, failed-run refusal, create-only output and explicit summary labeling for separate SDK snapshots. Exported support-script hashes are labeled **export-time**, not retrospectively asserted to have been captured before launch.

To export a new completed generated run (choose a new output path):

```sh
python3 scripts/export_demo_evidence.py \
  --results .local/demo-generated-conflict-v6/results.json \
  --preparation .local/localnet-generated-conflict-v6/preparation.json \
  --out .local/conflict-v6-public-review.json
node scripts/verify_archived_demo.mjs \
  --results .local/demo-generated-conflict-v6/results.json \
  --public-report .local/conflict-v6-public-review.json \
  --source-manifest .local/localnet-generated-conflict-v6/source-hashes.json \
  --module-root .local/toolchain/js --require-snapshots \
  --output .local/conflict-v6-archive-review.json
node --test tests/verify_demo_snapshots.test.mjs
```

The exporter requires retained compiled/client source manifests and operation descriptors beside the results. The combined signed-message archive verifier currently qualifies conflict only; compatible has its separate snapshot review and independent final SDK reads. Neither offline review independently verifies BLS signatures or proves historical consensus state.
