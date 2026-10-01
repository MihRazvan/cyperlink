# Implementation status

Updated 2026-10-01. CyperLink continues the selected Solana-native product: make private money programmable. Original research, fixtures and ledgers are preserved read-only. Implementation and new experiments live here.

## Current result

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
- Isolated replay/build tooling preserves exact versions and requires fresh ledgers. Six implementation programs and IDL rebuilt with SBF tools 1.57 / arch v0. Actual loaded-program verification has16 tests; Python verifier suites total 30. See [validation matrix](validation.md) and [replay instructions](local-replay.md).

## Decisions and security boundaries

- Scope: synthetic no-fee CT+hook mint, ordinary system-owned signing wallets, one quota/MXE, explicit administrator and owner query signatures, owner-signed settlement. No fee extension even at 0 bps; any CPI Guard extension is excluded. AUSD needs a separate fee-aware adapter. See [initial profile](initial-profile.md).
- A valid funded query may disclose one allow/deny result even if abandoned. It is not a reservation. Administrator authorization is per immutable operation; no automated untrusted query endpoint, background threshold search or silent renewal exists. Fresh queries need fresh authorization, Job/permit and a nonrecycled MXE-domain nonce.
- Historical static permit metadata could not support honest fresh operations. The 161-byte quota appends a transient active-permit pointer to the old 129-byte prefix. Only G-authorized arming sets it; atomic native hook consumption clears it. Queue and settlement validate exact canonical metadata. Permanent Job/permit claims remain.
- The new quota is H's canonical `["quota"]` PDA. Auth checks its canonical ProgramData and signing upgrade authority before selecting the administrator. Encrypted state initialization still requires a real signed runtime callback. This is a fresh deployment ABI, not an implicit migration of historical accounts.
- Review found predictable PDA prefunding could block `create_account`. Initializers now authenticate, top up only missing rent, then PDA-sign allocate/assign, preserving donations and rejecting existing application state. Compiled source provenance is included in v4/v5 reports.
- JavaScript Anchor is the actually installed 1.2.0; Rust/IDL CLI Anchor remains 1.0.2. Preserve all exact locks, reviewed upstream cryptography and circuit artifacts. Do not substitute latest versions.

## Limits and next work

Reproducibility is **same-machine**, depending on the original pinned validator/JS installation, cached digest-pinned Docker images and reviewed circuit artifacts. A clean-machine bootstrap and independent circuit rebuild remain next steps. Generic wallets/KMS, key rotation and backup, proof-context/Job/permit lifecycle cleanup, recovery beyond explicit evidence reconciliation, multi-quota support, fee adapters, production security review, public-network qualification and external customer advantage remain unproven.

All receipts here use explicit confirmed commitment; they do not claim finality or production throughput. Settlement CU/fees, native proof/provisioning, queue/callback transactions, circuit upload and callback wall time are separate categories. Worker CPU/network costs are unmeasured. For illustration only, compatible-v5 settlement used 79,057 CU for merchant and 80,775 CU for license; these exclude every other stage and are not general benchmarks.

Full evidence, signed wires, keys, source snapshots and preserved ledgers remain under ignored `.local/`. Only public reports are committed. v4/v5 services were stopped after evidence capture. Interrupted v1 and v3 are diagnostic only: v1 had a faulty negative fixture substitution; v3 preserved an unresolved delivery attempt, safe exact-operation retry and a harness confirmed/finalized observation mismatch. Neither is cited as a passing end-to-end run. Bounded retransmission now preserves identical signed bytes; observation commitment is explicit.

## Continue from here

Read this file, [initial-profile.md](initial-profile.md), [operation-contract.md](operation-contract.md), [validation.md](validation.md) and the [two-consumer example](../examples/two-consumers/README.md). Original context remains `/Users/razvan/Repos/colosseum/handoff/cyperlink/` guides 01–06 and canonical `CYPERLINK.md` sections 1, 6–18, 22–24. No third-party contact, real funds, public-network writes or production deployment are authorized.
