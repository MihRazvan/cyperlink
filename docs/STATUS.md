# Current status

Updated 2026-10-03. Product: programmable privacy infrastructure for Solana.
The implemented offering is human-approved confidential spending with original
customer-authored private policies. Application/agent permissions remain a separately
qualified native escrow experiment, not an extension silently enabled in the SDK.

## Working today

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
  floors and no broadcasting on uncertainty. The last live receipt was pruned;
  exact receipt restoration is host-tested only. Its license is paid but now expired.
- A direct pinned-upstream client passes selected matching cases using shared
  enforcement. Full standalone equivalence and comparative customer advantage remain
  inconclusive.

See [architecture/profile](architecture.md), [authoring/SDK](custom-policy-authoring.md)
and the [evidence index](evidence.md) for precise guarantees and commands. Existing
fixtures, raw archives and failed runs are preserved. Docs cleanup changes no runtime
source, dependency, program, circuit, application logic or evidence bytes.

## Next step

The [outside-builder exercise](builder-exercise.md) is prepared and accepted by
research. No participant, outreach, deployment or external test occurred. Next is a
real builder's supported workflow/confidentiality rationale, a sealed task and an
evaluator slot with verified runtime handoff. Ready-runtime usability and clean-machine
installation are separate tracks. Another internal app cannot substitute for this test.

The accepted package is preserved at Git tag `builder-exercise-v1`, commit
`18d8f7a`. Its exact tooling baseline is `c53caff`; use the tagged checkout for the
frozen run, not the cleaned current documentation. Research-004 accepted the package;
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
