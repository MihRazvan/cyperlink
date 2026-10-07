# Current status

Updated 2026-10-07. Product: programmable privacy infrastructure for Solana.
The implemented offering is human-approved confidential spending with original
customer-authored private policies. Application/agent permissions remain a separately
qualified native escrow experiment, not an extension silently enabled in the SDK.

The [end-to-end product assessment](PRODUCT-ANALYSIS.md) reviews the current code,
evidence and gaps before developer/team onboarding. Its first recommended milestone
is an operable local project, including safe retained-runtime restart and recovery
of interrupted setup, followed by portable application integration.
The [product research](PRODUCT-RESEARCH.md) adds current upstream/competitive evidence,
custody and operating requirements, and proposed acceptance gates. It does not broaden
the implemented profile or establish public-network qualification.

## Working today

- Versioned local project API and dependency-free TypeScript-declared HTTP client:
  durable registration/import, cached metadata, explicit fresh observation and keyless
  original-ticket recovery. Configured aliases bind original plan/journal identity;
  adding aliases preserves existing projects. No service signing or submission path.
- Managed validator/Arcium lifecycle: start, inspect, graceful stop and retained resume.
  A fresh policy deployment paid a license, survived whole-stack restart with exact
  payment recovery, then produced another genuine callback and paid license. Same
  genesis, three containers, retained runtime directories and validator identities.
- Policy builds run tests against staged source and retain test-bound qualification;
  new deployments require it. Atomic publication and `policy repair` cover interrupted
  generated-binding publication, while existing deployment identities remain readable.
- [CyperLink Console](../apps/console/README.md) connects an existing completed local
  policy deployment to a browser workspace with a payment inbox, separate native
  preparation/query/payment approvals, runtime identity and retained-operation recovery.
  It uses generated SDK sessions and explicitly configured local keyfiles. Browser-driven
  local execution has exercised genuine policy denial, a paid merchant purchase, a
  stale license intent, a separately approved fresh paid license and same-wire recovery.
  The clean two-consumer run passed with explicit unpaid supersession. A separate
  keyless process recovered the same payment across receipt/account HTTP503 faults
  and restored the actual original receipt, with no simulation or broadcast.
- A developer authors original typed rules/state in an application directory, tests,
  builds and deploys them with CyperLink tooling, then uses generated SDK bindings.
  Two materially different policies passed real local Arcium/native settlement.
- Complete native proof/account/funding admission, exact action/consumer binding,
  owner/admin query authorization, unique permits/nonces and authenticated callbacks.
- Atomic native payment, encrypted shared-state consumption and merchant/license
  effect, with stale-state, replay, binding and rollback qualification.
- Explicit signer sessions, durable approval/ticket discovery, keyless recovery and
  controlled SIGKILL coverage of the staging-to-ticket-save window.
- Receipt-outage recovery through bound account effects, with persistent observation
  floors and no broadcasting on uncertainty. The new Console run captured actual
  receipt restoration before pruning; the earlier v23b pruned-receipt result remains
  unchanged. Historical payment never renews an expired license.
- A direct pinned-upstream client passes selected matching cases using shared
  enforcement. Full standalone equivalence and comparative customer advantage remain
  inconclusive.

See [architecture/profile](architecture.md), [authoring/SDK](custom-policy-authoring.md)
and the [evidence index](evidence.md) for precise guarantees and commands. Existing
fixtures, raw archives and failed runs are preserved. Console adds a local application
over the generated session API; it does not introduce delegated execution or a new
cryptography/runtime enforcement path.

## Next product work

The retained-runtime and local service milestone is implemented and qualified. Next,
remove repository-specific storage/import assumptions from the policy SDK behind an
explicit storage contract, then add real proof/signer provider interfaces and recoverable
setup phases. Keep hosted project authentication/tenancy, asynchronous worker scheduling,
and durable database storage separate from the current loopback JSON service. The HTTP
client is dependency-free, but the underlying policy SDK is not yet portable.

Current qualification: `.local/service-instance-v1/instance.json`, runtime
`.local/localnet-service-runtime-v2`, archive `.local/service-runtime-qualification-v1`.
Two actual paid licenses advance quota version0→2 with original receipt/wire recovery
across full runtime shutdown. Service recovery ran in a separate process without signer
options. The 185-test JavaScript regression, three additional offline-verifier tests, 90 Python
tests and cipher-domain host check pass.
An independent offline review is indexed in [evidence](evidence.md). The initial gossip
collision, TIME_WAIT restart bug and qualification observer-directory error remain
preserved; none is counted as a passing attempt. Runtime readiness alone still means
process/RPC readiness; the post-restart callback/payment is separate execution evidence.

The current profile stays synthetic local assets, administrator co-signing, no transfer
fees, configured hook and CPI Guard disabled. Same-host nodes/trusted dealer remain.
Graceful restart is qualified; power loss, pending-computation restart, arbitrary partial
provisioning recovery and production/public-network operation are not.

Current local reference: `.local/console-instance-v1/instance.json`, retained workspace
`.local/console-workspace-v2`. The clean browser archive is `.local/console-browser-v2/`;
keyless recovery is `.local/console-recovery-v2b/`; read-only visual checks are
`.local/console-visual-v2/final/`. The earlier Console workspace and failed harness
attempts are preserved. The underlying v21 ledger was retained, not reset. This run
advances its new policy instance from quota version2/counter5 to version4/counter9.
The final host regression passed 164 tests; offline review checked ten signed messages,
16 signatures, four callbacks and both exact paid effects. See [evidence](evidence.md).

The outside-builder exercise remains deferred and frozen at `builder-exercise-v1`;
see [archived workflows](evidence.md#archived-workflows). No external test occurred.

## Repository scope after cleanup

The active tree contains Console, generated policy SDK/CLI, native proof/admission
code, pinned bootstrap, customer-policy examples and the paid-license/session reference.
Superseded Approvals/two-consumer demos, direct comparison client, Permissions executable
probe and research replay/export tools are archived at `console-reference-v2` (`165ef57`).
Evidence, original fixtures and raw local runs are preserved; relevant lock/deployment
tests were moved alongside their maintained implementations. The cipher-domain check
is now `tests/cipher-domains.mjs`.

Dependency review found that `programs/native`, `programs/auth`, `circuits/budget` and
the eight checked-in circuit artifacts still form the supported bootstrap. They are
not dead code. All shared Rust crates and SDK/native codecs are still required.
Bootstrap now owns its local network helpers independently of the removed research
replay script. Removing the bootstrap's fixed programs would be a separate runtime
redesign requiring new qualification, not repository housekeeping.

Post-cleanup checks: 161 maintained JavaScript tests (including real compiler/package
tests), 65 Python bootstrap tests, the cipher-domain check, and the existing Console
archive review pass. A fresh keyless adapter connection rechecked ten loaded ELFs and
the generated release against the running instance. Program/circuit and cryptographic
source, dependency locks, original fixtures and evidence bytes are unchanged. No new
payment or distributed-computation run is claimed for this structural cleanup.

## Continuation constraints

Keep native account keys client-side and use exact pinned upstream cryptography.
Preserve native/consumer binding, authorization, nonce uniqueness, callback admission,
atomic effects and quota checks. Compare actual loaded ELFs after runtime source changes.
Distinguish host, simulation, local validator, distributed and public-network evidence.

No third-party contact, real funds, public-network writes or production deployment
is authorized. Cold-machine reproducibility, broader assets/fee adapters, provisioning
recovery, wallet/KMS integration and production review remain separately scoped work.
