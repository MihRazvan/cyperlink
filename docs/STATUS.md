# Implementation status

Updated 2026-10-02. CyperLink continues the selected Solana-native product: make private money programmable. Original research, fixtures and ledgers are preserved read-only. Implementation and new experiments live here.

## Active milestone: SDK lifecycle and restart recovery

Implementation underway; [scope and ordered plan](lifecycle-implementation.md). Review found that delayed queries could select a newer quota/counter than their retained client intent. The new explicit snapshot digest rejects that drift before private computation; host tests pass, live qualification is pending. Durable same-wire submission, reusable preparation/settlement APIs and separate-process recovery tests are being integrated. Historical passing reports below do not qualify these source changes.

## Latest completed continuation: fresh bootstrap

**Both scenarios now pass without the original research checkout as an execution input.** Repository installers preserve the exact JavaScript, native CLI, program and Docker versions. Both real runtime circuits were rebuilt from locked source: all eight artifacts match the reviewed bytes exactly. Each new run generated its own administrator and node identities plus 60 upstream runtime genesis accounts; native assets and all CyperLink state still came from signed instructions. Ten actual loaded ELFs matched in each run.

- [Generated conflict-v6](../evidence/2026-10-01/two-consumers-generated-conflict-v6.json): A60 paid; B stale803; honest fresh B60 denied; binding705, post-native-transfer1099 rollback and replay1001 rejected. Final quota version1/counter4.
- [Generated compatible-v7](../evidence/2026-10-01/two-consumers-generated-compatible-v7.json): A40 and freshly recomputed B40 both paid their exact consumer entitlements. Final quota version2/counter3. Independent final SDK reads observed both committed.

Raw single-bank before/after tracked-account snapshots are now retained, closing the older v4 archive's rollback-review gap. The [combined conflict review](../evidence/2026-10-01/independent-generated-conflict-v6-review.json) checked 1,323 Ed25519 signatures over 1,267 messages, four callback decodes, all ten ELF hashes, source manifests and 33 unchanged tracked-account comparisons. The compatible snapshot review verified both exact paid successors. Host validation passed 76 Python tests, 25 SDK/client/example tests and seven snapshot corruption groups. These are confirmed RPC observations, not historical state proofs or finality claims. Requested amounts and remaining40/20 are test-observer disclosures. Both runs' services are stopped; ledgers, keys, receipts and source snapshots remain preserved under `.local/`.

Follow [fresh bootstrap](local-bootstrap.md). Qualification covers Darwin ARM64 on this development host, with existing Rust/SBF caches and Docker prerequisites. It does not establish a blank-machine installation, independently reproducible native compiler output, independent node operators or production security. Public RPC was used only to retrieve hash-checked upstream program artifacts; no public transaction was sent. The earlier replay path and reports below remain historical evidence.

## Earlier completed implementation

**The initial implementation milestone is complete for the bounded local profile.** Shared native admission validation, client-owned keys/proof provisioning, operation builders/lifecycle SDK and both authenticated consumer scenarios are implemented and tested. Small reviewed slices are pushed to `origin/main`.

Two fresh Agave 4.3.0 ledgers and fresh two-node Arcium 0.15.0 runtimes passed with only 61 runtime genesis accounts. Native mint/accounts, proof contexts, permits, quota, hook metadata and consumer records were created through real signed instructions. All ten loaded program ELFs matched the exact staged binaries, including native Token-2022 and Arcium dependencies. Runtime circuits remained the reviewed commitment-bound artifacts; no fixture-key circuit, injected verified context or preauthorized permit was used.

| Scenario | Actual result | Evidence |
| --- | --- | --- |
| Conflict: 60+60 against100 | Both authorized at version 0. A60 paid and issued merchant SKU. B's license authorization rejected stale803; fresh owner/admin-authorized B60 recomputation denied. Final quota version 1/counter 4. | [conflict-v4](../evidence/2026-10-01/two-consumers-conflict-v4.json) |
| Compatible: 40 then fresh40 against100 | Merchant payment/entitlement committed; B recomputed against version 1 and committed native payment plus exact product/expiry license. Final quota version 2/counter 3. Independent post-run SDK reads confirmed both paid records. | [compatible-v5](../evidence/2026-10-01/two-consumers-compatible-v5.json) |

Remaining 40/20 are **test-observer inferences** from disclosed synthetic setup/purchases, not decryption of MXE state. Both scenarios use the same synthetic mint within their own ledger. They use independent client source/destination owners sharing one administrator-authorized allowance. These are two internal consumer implementations, not external integration commitments.

Conflict adversarial transactions reached exact binding rejection705 for changed destination, changed application action and changed consumer, with correctly recomputed consumer PDAs. Forced merchant1099 failure occurred after native transfer and rolled back all tracked state. Stale803 and replay1001 rejected. Deliberately prefunded quota, metadata and consumer PDAs initialized successfully after the availability fix. The SDK observed authorization, commit, stale state and fresh denial from locally retained operation descriptors.

## Completed implementation

- Archived verifier checks 46 pinned artifacts; 14 verifier tests. Rechecked originals after implementation: all unchanged. Initial imported auth rebuilt to the exact historical `cedff496…c782a0` ELF.
- Strict shared admission validator runs before queue and at settlement: genuine context ownership/type/shape, upstream equality/grouped/range relations, encryption keys, present funding/arithmetic, destination capacity, exact instruction and supported accounts/extensions. Twelve host groups reverify six genuine proof payloads before adversarial cases. Nine signed malformed queues were also rejected before computation in [routing-v2](../evidence/2026-10-01/admission-routing-v2.json); three bad encrypted witnesses produced authenticated false outputs. This earlier run used preserved synthetic native genesis assets and a historical quota key.
- Client Rust library persists mode0600 ElGamal/AES keys, verifies current source state and generates fresh upstream proofs. Reusable account secrets remain client-side; only operation amount/opening enter encrypted MPC inputs. Signed JS provisioning performs actual native verification and buffer cleanup. Four Rust lifecycle groups and seven JS client groups pass.
- SDK exports exact native/action and merchant/license digest builders plus a consistent-read lifecycle observer. Fifteen host groups cover binding, paid effects, stale/expiry/cancel/denial recovery and forged/partial evidence. Three example builder/settlement groups pass. Callback completion alone never establishes payment.
- Quota/metadata/consumer provisioning uses authenticated instructions and PDA allocation. Seven native initializer tests plus the shared helper rejection test pass. [Provisioning-v3 negatives](../evidence/2026-10-01/provisioning-negatives-v3.json) distinguish nine signed simulations from three actual buffer lifecycle transactions; these predate the prefunding fix qualified in v4/v5.
- Isolated replay/build tooling preserves exact versions and requires fresh ledgers. Six implementation programs and IDL rebuilt with SBF tools 1.57 / arch v0. Actual loaded-program verification has16 tests; Python verifier suites total 30. See [validation matrix](validation.md) and [fresh bootstrap instructions](local-bootstrap.md).

## Decisions and security boundaries

- Scope: synthetic no-fee CT+hook mint, ordinary system-owned signing wallets, one quota/MXE, explicit administrator and owner query signatures, owner-signed settlement. No fee extension even at 0 bps; any CPI Guard extension is excluded. AUSD needs a separate fee-aware adapter. See [initial profile](initial-profile.md).
- A valid funded query may disclose one allow/deny result even if abandoned. It is not a reservation. Administrator authorization is per immutable operation; no automated untrusted query endpoint, background threshold search or silent renewal exists. Fresh queries need fresh authorization, Job/permit and a nonrecycled MXE-domain nonce.
- Historical static permit metadata could not support honest fresh operations. The 161-byte quota appends a transient active-permit pointer to the old 129-byte prefix. Only G-authorized arming sets it; atomic native hook consumption clears it. Queue and settlement validate exact canonical metadata. Permanent Job/permit claims remain.
- The new quota is H's canonical `["quota"]` PDA. Auth checks its canonical ProgramData and signing upgrade authority before selecting the administrator. Encrypted state initialization still requires a real signed runtime callback. This is a fresh deployment ABI, not an implicit migration of historical accounts.
- Review found predictable PDA prefunding could block `create_account`. Initializers now authenticate, top up only missing rent, then PDA-sign allocate/assign, preserving donations and rejecting existing application state. Compiled source provenance is included in v4/v5 reports.
- JavaScript Anchor is the actually installed 1.2.0; Rust/IDL CLI Anchor remains 1.0.2. Preserve all exact locks, reviewed upstream cryptography and circuit artifacts. Do not substitute latest versions.

## Limits and next work

The old-checkout execution dependency is removed and the circuits now rebuild exactly from source. A blank-machine qualification remains open: install and qualify host Rust/SBF compiler caches, expand platform support explicitly, and verify the full workflow on a second machine. Do not treat the current same-host bootstrap as that result. Generic wallets/KMS, key rotation and backup, proof-context/Job/permit lifecycle cleanup, recovery beyond explicit evidence reconciliation, multi-quota support, fee adapters, production security review, public-network qualification and external customer advantage remain unproven.

All receipts here use explicit confirmed commitment; they do not claim finality or production throughput. Settlement CU/fees, native proof/provisioning, queue/callback transactions, circuit upload and callback wall time are separate categories. Worker CPU/network costs are unmeasured. For illustration only, compatible-v5 settlement used 79,057 CU for merchant and 80,775 CU for license; these exclude every other stage and are not general benchmarks.

The [independent conflict archive review](../evidence/2026-10-01/independent-conflict-v4-review.json) verified 1,323 Ed25519 signatures and matched callbacks, failure receipts, ELF reports and source hashes. Its limitations distinguish executed rollback assertions from independently retained account snapshots.

Full evidence, signed wires, keys, source snapshots and preserved ledgers remain under ignored `.local/`. Only public reports are committed. v4/v5 services were stopped after evidence capture. Interrupted v1 and v3 are diagnostic only: v1 had a faulty negative fixture substitution; v3 preserved an unresolved delivery attempt, safe exact-operation retry and a harness confirmed/finalized observation mismatch. Neither is cited as a passing end-to-end run. Bounded retransmission now preserves identical signed bytes; observation commitment is explicit.

## Continue from here

Read this file, [initial-profile.md](initial-profile.md), [operation-contract.md](operation-contract.md), [validation.md](validation.md) and the [two-consumer example](../examples/two-consumers/README.md). Original context remains `/Users/razvan/Repos/colosseum/handoff/cyperlink/` guides 01–06 and canonical `CYPERLINK.md` sections 1, 6–18, 22–24. No third-party contact, real funds, public-network writes or production deployment are authorized.
