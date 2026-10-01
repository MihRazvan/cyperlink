# Implementation status

Updated 2026-10-01. This repository continues the completed research; historical evidence is preserved in the original research root.

## Proven baseline and limits

The final `bound-join` research run verified genuine native proofs and owner signatures, two-node Arcium runtime keys and signed outputs, immutable Jobs and unique permit claims, restricted callback admission, and atomic native transfer / encrypted quota advancement / merchant entitlement. The circuit gates policy disclosure against the native grouped amount commitment. Loaded ELF and transaction/account evidence were independently checked in that research run.

The research queue does not validate every equality/range/grouped/account/funding relationship before disclosure. Two consumers were tested with staged admission in a separate SVM harness; only the merchant joined the final live path. Portable provisioning, fresh two-consumer recomputation, recovery, production security, external demand and comparative customer advantage remain unproven. Historical tests are not new executions in this repository.

## Implementation sequence

1. Establish reproducibility: verify archived provenance, import only reviewed source and pinned lockfiles, isolate new run outputs, build and validate loaded binaries.
2. Complete admission: share a strict no-fee native validator across queue and settlement where possible, reuse upstream proof extraction, reject inconsistent verified proof sets and unsupported profiles before allocating computation. Preserve circuit commitment gating. Specify authorized-query semantics in `initial-profile.md`.
3. Client provisioning/lifecycle: local mint/accounts and proof buffers, client-owned witnesses, explicit operation IDs/status/recovery, no manually injected authorization. Read Job, permit and committed consumer effects together.
4. Authenticated two-consumer demo: competing 60+60/100, stale rejection, fresh 60/40 denial, recomputed 40+40 success, changed recipient/action/consumer, replay and post-transfer rollback. Separate public and test-observer output.

## Current work

- Repository inspection: only initial README and user-supplied handoff pointer; no existing implementation.
- Supported initial scope and query authorization recorded.
- Independent admission review and archived-provenance tooling underway.
- Next code gate: exact native transfer validation before private evaluation, with adversarial proof-set tests.

## Continuation and evidence

Start from this file, `initial-profile.md`, then the original `handoff/cyperlink/` guides 01–06 and canonical `CYPERLINK.md` sections 1, 6–18, 22–24. The latest source is `research/cyperlink-prebuild-2026-10-01/bound-join/cyperlink_auth`, `native-live/{guard,policy,merchant,interface}`, and `admission-review/bound-circuit`; earlier scaffold generators are not authoritative.

No new validator/distributed replay has completed here yet. Record exact commands/results and substantive architecture changes as each slice lands. No third-party contact, real funds, public-network writes or production deployment are authorized.
