# Current status

Updated 2026-10-05. Product: programmable privacy infrastructure for Solana.
The implemented offering is human-approved confidential spending with original
customer-authored private policies. Application/agent permissions remain a separately
qualified native escrow experiment, not an extension silently enabled in the SDK.

## Working today

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

The user reprioritized building the product around Console. Next add guided project
onboarding and policy author/test/build/deploy workflows. Today the Console requires
an existing completed local deployment; those setup steps remain in the CLI. Keep
ready-runtime usability distinct from clean-machine installation. Wallet integration
and broader deployment profiles require separately scoped work.

Current local reference: `.local/console-instance-v1/instance.json`, retained workspace
`.local/console-workspace-v2`. The clean browser archive is `.local/console-browser-v2/`;
keyless recovery is `.local/console-recovery-v2b/`; read-only visual checks are
`.local/console-visual-v2/final/`. The earlier Console workspace and failed harness
attempts are preserved. The underlying v21 ledger was retained, not reset. This run
advances its new policy instance from quota version2/counter5 to version4/counter9.
The final host regression passed 164 tests; offline review checked ten signed messages,
16 signatures, four callbacks and both exact paid effects. See [evidence](evidence.md).

The [outside-builder exercise](builder-exercise.md) is prepared and accepted by
research, but deferred under this product priority. No participant, outreach or external
test occurred. Console development is internal product work, not external customer
validation. A future exercise still needs a real builder, a sealed task, an evaluator
slot and a verified runtime handoff.

The accepted package is preserved at Git tag `builder-exercise-v1`, commit
`18d8f7a`. Its exact tooling baseline is `c53caff`; use the tagged checkout for the
frozen run, not the current Console checkout. Research-004 accepted the package;
implementation-004 records cleanup and the historical checkout path in the authorized
mailbox `/Users/razvan/Repos/colosseum/handoff/cyperlink/agent-mailbox/`.
There is no background mailbox monitor or open-ended internal implementation loop.

## Continuation constraints

Keep native account keys client-side and use exact pinned upstream cryptography.
Preserve native/consumer binding, authorization, nonce uniqueness, callback admission,
atomic effects and quota checks. Compare actual loaded ELFs after runtime source changes.
Distinguish host, simulation, local validator, distributed and public-network evidence.

No third-party contact, real funds, public-network writes or production deployment
is authorized. Cold-machine reproducibility, broader assets/fee adapters, provisioning
recovery, wallet/KMS integration and production review remain separately scoped work.
