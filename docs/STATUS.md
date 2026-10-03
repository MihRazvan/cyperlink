# Implementation status

Updated 2026-10-03. CyperLink continues the selected Solana-native product: make private money programmable. Original research, fixtures and ledgers are preserved read-only. Implementation and new experiments live here.

## Completed: explicit sessions and crash-window recovery

The passing license application at `cce20f3` and its v21b evidence remain unchanged
and were reverified. The additive [session milestone](license-session-milestone.md)
now qualifies explicit signer roles, keyless reopening and SDK-owned durable ticket
discovery. Four actual SIGKILL boundaries across query/payment recovered identical
transactions through new processes; two local Arcium callbacks produced two real
paid licenses. A fifth interruption before signed-record publication refuses
restaging. Independent review checks6 messages/10 signatures,48 unchanged read-only
account comparisons,10 loaded programs,2 uploaded circuits and10 corruption cases.

The first harness expiry1101 simulation rejection remains archived; successful
v22b began with unspent version0/counter2 and ended at version2/counter4. Same
qualified local profile; no cryptography/program/circuit changes. See the milestone
for commands, tests and the distinction between process observations and proofs.

## Completed: controlled direct-client comparison

The [direct comparison](license-client-comparison.md) now includes actual execution
using pinned web3/Anchor/Arcium with its own client preparation, ABI, durable sender
and reconciliation. Final v22c passes the reference five-decision/two-license
scenario, three landed atomic/stale/replay rejections, lost-acknowledgement recovery,
four signed-wire/simulation SIGKILL recoveries and a fifth pre-publication refusal.
Independent review checks 15 messages / 25 signatures, 5 callbacks, 2 paid licenses,
7 exact wires/attempt records, 36 rejection and 60 read-only account comparisons,
10 loaded ELFs, 2 uploaded circuits, 6 frozen source snapshots and 9 corruption cases.

The [source accounting](../evidence/2026-10-03/license-client-source-surface.json)
separates the application adapters, reusable SDK and shared proof/enforcement/
authoring work. Both clients share reviewed CyperLink onchain programs, policy
circuit, native proof bridge and deployment/provisioning. This is an executed
client comparison; full standalone upstream replacement, arbitrary failure-mode
parity, external developer productivity and comparative customer advantage remain
inconclusive. Direct receipt-outage account reconciliation is credited explicitly.
Failed and intermediate runs are retained; no source changed during final execution.

Current completed instances on RPC8985: `.local/license-session-instance-v22/`
and `.local/license-direct-instance-v22c/`. Raw final archives are
`.local/license-session-qualification-v22b/` and `.local/direct-license-qualification-v22c/`.
Nine direct host groups and strict retained-input probes supplement real execution;
they do not substitute for it. Original reference files/archives remain unchanged.
Next useful evidence: an unaided builder reproduction of the improved session API;
standalone enforcement comparison requires separately scoped implementation.

## Completed: separate paid-license application rehearsal

The [rehearsal](license-app-rehearsal.md) passes through a separate docs-first
application using generated SDK bindings, without a core policy/native change.
Its private cap/allowance rule produced five genuine local Arcium callbacks and
two paid licenses: cap40 denied; competing30 purchases both authorized; A30 paid;
B rejected stale803; freshB30 denied against remaining20; freshB20 paid. Initial
values and arithmetic are synthetic test-observer disclosures.

The [safe summary](../evidence/2026-10-03/license-app-v21b.json) records native
post-transfer1199 rollback, issued-license replay1102 rejection, repeated-query
ticket reuse, and same-byte payment recovery after actual acknowledgement loss
and injected receipt unavailability across fresh processes. Ten loaded ELFs and
two uploaded circuits match. Only final committed effect establishes payment.
The [independent offline review](../evidence/2026-10-03/license-app-v21b-offline-review.json)
checks15 messages/25 Ed25519 signatures, seven exact tickets, two keyless workers
and36 unchanged rejection-account comparisons; it makes no independent BLS or
historical consensus-proof claim.
Six offline archive-corruption checks also reject altered or missing evidence;
these are separate from the three actual landed rejection transactions.

Integration exposed a pinned upstream cache-verification incompatibility and an
application journal-reopening bug; both are fixed and documented. Fourteen policy
IR vectors, three app safety tests and eighteen toolchain tests pass. The
[upstream comparison](license-app-upstream-comparison.md) credits upstream polling
and identical-byte retries; it is a source/API review, not an executed equivalent
baseline or a measured advantage. Internal author assistance and missing ticket
rediscovery remain explicit. No external developer/customer validation is claimed.

Current fresh runtime: v21 RPC8985, compose `cyperlink-license-app-v21`.
The completed instance is `.local/license-app-instance-v21b/`; initial v21's
partly successful harness and paid state are retained. Previous ledgers remain
intact. The explicit local SBPFv0 feature override and existing owner/admin trust
profile remain unchanged. The follow-up session and controlled direct-client milestones
above now address that integration friction and selected comparison cases.
Independent builder reproduction remains next; GLAM and cross-MXE are conditional
extensions.

## Customer-authored private policies: real local path qualified

The authored-package → compiler → deployment → genuine private decision → native
payment/effect → exact recovery path passes. See [developer quickstart](custom-policy-authoring.md),
[qualification and reproduction](custom-policy-qualification.md),
[safe run summary](../evidence/2026-10-02/custom-policies-v20b.json) and
[independent review](../evidence/2026-10-02/custom-policy-v20b-offline-review.json).

- `budget-count` paid merchant40 at count4→5, then denied fresh1 with budget/funding
  left. `minimum-reserve` denied40 and paid license20 against privately initialized
  reserve70. Amounts and inferred private outcomes are synthetic observer disclosures.
- Two independent customer directories use the same typed authoring/CLI/generated
  SDK flow. The second was authored by another internal agent without a core
  name branch. Distinct generated programs, MXEs/keys, states and mint hooks coexist
  on v20. Same local operators and upgrade-authority trust remain explicit.
- Real matrix passed exact input/authority/isolation failures, expired/cancelled
  operations, counter-only delayed-query6004, callback authentication, post-native
  rollback1099, stale803, replay1001 and keyless exact-byte recovery.
- Independent review verified9,087 signed messages/9,283 Ed25519 signatures,
  12 callbacks including initialization,22 landed rejections,319 unchanged account
  comparisons,2 paid effects,9 exact tickets,4 recovery processes,15 loaded ELFs
  and4 uploaded circuit byte/interface proofs. No independent offline BLS or
  historical consensus-state-proof claim.
- Validation:144 Node SDK/example/archive tests,8 CLI groups,82 Python tests,
  plus targeted Rust checks and strict generated TypeScript compilation. CLI
  enforces qualified host Rust/Cargo versions. No dependency upgrade was needed.

The chosen fallback preserves the full native SDK7 amount/opening bridge in
ScalarField253/CSpl. High-level Arcis's different cipher domain was not assumed
compatible. New `local-custom-policy-v1` has353-byte state/712-byte permits and
four encrypted slots; legacy profiles, fixtures, Approvals and Permissions survive.

V20 explicitly disables only the default local SIMD-0500 deployment restriction
for pinned SBPFv0; this is not default-cluster parity. An earlier shared build-cache
fault rejected provisioning834; isolated generated build targets fixed it. The
first matrix attempt stopped on a test-runner signer mismatch before payment;
v20b reused untouched business states with nonces preserved. Failed archives and
all historical ledgers remain intact. V19's separate real legacy budget40 control
also paid/recovered successfully before its services stopped.

Services recorded at the v20 milestone: RPC8983, two-node compose `cyperlink-custom-policies-v20`,
and custom Approvals HTTP4317 (restarted server PID6705). The live custom UI paid
merchant5 after explicit query/final approvals, lost its send acknowledgement, then
recovered the identical payment after an actual server restart through a separate
keyless process. Reserve state advanced to version2; an independent final read
confirmed the entire count state unchanged. No private initialization/remaining
values are exposed. See [UI evidence](../evidence/2026-10-02/custom-policy-ui-v20-review.json). Raw archives
and stop/restart guidance are in qualification. User-owned `00-START-HERE` untouched.

Remaining scope: independently operated/public deployment, second-machine builds,
security review, fee/AUSD adapters, same-mint routing, richer authenticated inputs,
state migration and arbitrary partial-deployment recovery. Those are extensions,
not claims made by this local milestone. Autonomous Permissions remains its separate
native escrow experiment; it has not acquired Arcium/delegated-wallet guarantees.

## Latest continuation: interactive Approvals and isolated Permissions

**Interactive human-approved spending passes fresh real local qualification.**
The [Approvals interface](../examples/approvals/README.md) uses the completed SDK,
with separate query/final approvals, exact paid effects, durable tickets and
keyless recovery. Account decryption keys stay in the local client. Public and
owner projections label synthetic test-observer disclosures. Desktop/mobile
browser checks passed; see [qualification and screenshots](approvals-qualification.md).

- Compatible-v16: merchant40 and freshly recomputed license40 both paid. A lost
  send acknowledgement, actual server restart and separate keyless worker
  reconciled the original payment signature. Ten loaded ELFs, four signed tickets,
  two paid effects and two real runtime callbacks independently checked.
- Conflict-v18: both60 requests authorized; A paid, B became stale. Direct stale
  API submission rejected400 with no new payment ticket (client guard, not a new
  native803 claim). Explicit fresh B60 was denied. Four signed tickets, three
  authenticated callbacks (allow/allow/deny), ten loaded ELFs and final
  committed/stale/denied effects checked.
- Validation:106 Node SDK/client/example/snapshot/verifier tests and80 Python
  tests passed. Host adapters do not stand in for the real runs. Session exclusion,
  durable save ordering and recovery of a journaled commit before an older query
  are covered. Existing on-chain programs/circuits/dependency versions unchanged.

**Permissions has a bounded feasibility result, not a second product SDK mode.**
The [isolated probe](permissions-feasibility.md) rejects ordinary native delegate
spending, then proves a different scoped-escrow profile on a real local validator:
fresh agent-generated proofs and sole agent execution signature after an owner
grant; native encrypted funding depletion and atomic scoped receipt; seven
signed adversarial failures, revocation and honest refund. Offline review checked
75 messages/125 signatures and seven unchanged account snapshot pairs. No Arcium
policy, priced entitlement, wallet-key sharing or malicious-cache recovery claim
is made. The original Approvals profile is preserved.

The identified v18 HTTP/RPC/two-node services were stopped for the new custom-policy
qualification; its ledger and reports are preserved. Exact paths/PIDs/stop guidance are in
[qualification](approvals-qualification.md). v16 and Permissions services stopped.
Original evidence and user-owned `00-START-HERE` remain untouched. Small slices
are committed and pushed to `origin/main`.

Next: improve client provisioning/recovery ergonomics; before a Permissions SDK,
qualify malicious balance-cache recovery, wrong executor/use-limit exhaustion,
post-native application rollback and a useful exact-priced consumer. Finite
private-query authority must be implemented before joining autonomous grants to
Arcium policy. Cross-MXE and second-machine qualification remain separate work,
not prerequisites retroactively attached to this completed local milestone.

## Latest completed milestone: SDK lifecycle and restart recovery

**The bounded local SDK lifecycle and recovery milestone passes.** The [local operation API](../packages/local-client/OPERATION.md) prepares native proofs/actions, obtains explicit owner/admin query signatures, retains exact signed transactions, submits and observes paid effects. Separate keyless processes reconcile or explicitly retransmit retained bytes without replacing signatures, blockhashes, query identities or private inputs. Query recovery verifies the live immutable PreparedAction against the retained native payment and consumer template. Reusable account decryption keys remain client-side.

- [Compatible-v13](../evidence/2026-10-02/two-consumers-sdk-compatible-v13.json): A40 and freshly recomputed B40 both paid and issued their exact merchant/license records. Final quota version2/counter3. Nine recovery processes reconciled four distinct signed tickets, including a deliberately lost B send response. [Recovery review](../evidence/2026-10-02/sdk-compatible-v13-recovery-review.json); [independent full review](../evidence/2026-10-02/independent-sdk-compatible-v13-review.json).
- [Conflict-v15](../evidence/2026-10-02/two-consumers-sdk-conflict-v15.json): both initial60 queries authorized; A paid, stale B rejected803, fresh B60 denied. A delayed owner/admin-signed query rejected6004 before private computation after counter-only drift. Quota/permit remained unchanged and Job/claim/computation remained absent. Binding705, post-native-transfer1099 rollback and replay1001 passed. Eleven recovery processes reconciled five distinct signed tickets. [Recovery review](../evidence/2026-10-02/sdk-conflict-v15-recovery-review.json); [signed archive and snapshots](../evidence/2026-10-02/independent-sdk-conflict-v15-review.json).

Each fresh ledger used new upstream runtime identities, genuine native proof verification, real two-node Arcium callbacks and ten matching actual loaded ELFs. Auth was rebuilt after adding the signed quota state/counter digest; no account layout or circuit changed. Independent archive checks verified 1,282 Ed25519 signatures for compatible and1,350 for conflict, including 33 unchanged tracked-account comparisons across the original six conflict rejection pairs. Separate checks cover the new 6004 receipt and its absent/unchanged accounts. These are confirmed RPC observations, not historical consensus proofs or an independent BLS verifier. Amounts, remaining20/40 and response-loss injection are labeled test-observer disclosures.

Validation: 80 Python tests, 77 Node SDK/client/example/snapshot tests, five recovery archive groups and four Auth snapshot host tests passed. Host fixtures remain distinct from the real validator/distributed evidence above. Both final runs' services are stopped; raw receipts, ledgers, keys and execution source snapshots remain in ignored `.local/`. Small implementation and evidence slices are pushed to `origin/main`.

Delivery investigation preserved failed v8/v10/v11 attempts. Agave's rooted-bank lookup resolution could not yet see newly confirmed ALT extensions; simulation succeeded while ingress dropped packets. The sender now waits for finalized table visibility before obtaining a fresh application blockhash and signing. V9 failed preparation because the generator probed an occupied default RPC port; v14 failed startup because the prior validator still held faucet port 9900. Neither is chain execution evidence. V12 passed the conflict flow before the final immutable-action recovery check and remains an earlier local archive. All those services are stopped; no ledger was reset. Follow the single-validator startup guidance in [local bootstrap](local-bootstrap.md).

Continuation: build the interactive experience, then probe bounded Permissions as described above. Second-machine installation remains a separate qualification gate. This milestone starts recovery after a complete retained operation; arbitrary interrupted native provisioning, cleanup, wallet/KMS support and production deployment remain out of scope. See the [completed implementation plan](lifecycle-implementation.md).

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

The old-checkout execution dependency is removed and the circuits now rebuild exactly from source. A blank-machine qualification remains open: install and qualify host Rust/SBF compiler caches, expand platform support explicitly, and verify the full workflow on a second machine. Do not treat the current same-host bootstrap as that result. Generic wallets/KMS, key rotation and backup, proof-context/Job/permit lifecycle cleanup, resume during partially completed native provisioning, multi-quota support, fee adapters, production security review, public-network qualification and external customer advantage remain unproven.

All receipts here use explicit confirmed commitment; they do not claim finality or production throughput. Settlement CU/fees, native proof/provisioning, queue/callback transactions, circuit upload and callback wall time are separate categories. Worker CPU/network costs are unmeasured. For illustration only, compatible-v5 settlement used 79,057 CU for merchant and 80,775 CU for license; these exclude every other stage and are not general benchmarks.

The [independent conflict archive review](../evidence/2026-10-01/independent-conflict-v4-review.json) verified 1,323 Ed25519 signatures and matched callbacks, failure receipts, ELF reports and source hashes. Its limitations distinguish executed rollback assertions from independently retained account snapshots.

Full evidence, signed wires, keys, source snapshots and preserved ledgers remain under ignored `.local/`. Only public reports are committed. v4/v5 services were stopped after evidence capture. Interrupted v1 and v3 are diagnostic only: v1 had a faulty negative fixture substitution; v3 preserved an unresolved delivery attempt, safe exact-operation retry and a harness confirmed/finalized observation mismatch. Neither is cited as a passing end-to-end run. Bounded retransmission now preserves identical signed bytes; observation commitment is explicit.

## Continue from here

Read this file, [initial-profile.md](initial-profile.md), [operation-contract.md](operation-contract.md), [validation.md](validation.md) and the [two-consumer example](../examples/two-consumers/README.md). Original context remains `/Users/razvan/Repos/colosseum/handoff/cyperlink/` guides 01–06 and canonical `CYPERLINK.md` sections 1, 6–18, 22–24. No third-party contact, real funds, public-network writes or production deployment are authorized.
