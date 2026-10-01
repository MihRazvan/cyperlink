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
- Archived verifier passes: 46 pinned artifacts; 14 corruption/semantic tests. No original evidence changed.
- Imported auth rebuild exactly matches historical ELF `cedff496…c782a0`; native programs also build with SBF 1.57/v0. Direct dependencies pin actual lockfile resolutions, with no existing dependency version changes.
- Shared strict native validator now runs before queue and at settlement. Twelve host test groups pass, rechecking six genuine proof payloads before inconsistent-context/account/funding/profile tests. Ordinary empty system-owned owner wallets only; native multisig semantics are explicitly excluded.
- Isolated replay tooling and live loaded-program verifier implemented (16 verifier tests). First development replay `admission-v1` checked the changed loaded auth ELF and rejected four signed malformed queries before computation. The replay stopped on a faulty negative test that substituted the same shared mint; this is a harness error, not a passing end-to-end run. Fixed the test to substitute an actual wrong account. That preliminary ELF also predates the explicit ordinary-owner restriction; a fresh run is required.
- Current code gate: dynamic hook routing with a transient active-permit pointer, strict queue/commit metadata validation, then a fresh complete validator/distributed replay. Client key/proof preparation and lifecycle SDK work are proceeding in separate packages.

## Decisions after source inspection

- Full current executability includes hook account resolution. The old metadata fixes one permit per source, which cannot support honest fresh operations while retaining permanent PermitClaim assignment. The selected replacement appends an active-permit pointer to quota (129 → 161 bytes), set only during G-authorized arm and cleared by atomic hook consumption. Metadata resolves quota then this pointer; queue and guard must validate its exact schema. Permanent per-operation claims remain.
- JavaScript Anchor actually resolves to **1.2.0** in the archived lock/install; Rust Anchor and IDL binary are **1.0.2**. Preserve both exact versions rather than treating the original JavaScript semver lower bound as its installed version.

## Continuation and evidence

Start from this file, `initial-profile.md`, then the original `handoff/cyperlink/` guides 01–06 and canonical `CYPERLINK.md` sections 1, 6–18, 22–24. The latest source is `research/cyperlink-prebuild-2026-10-01/bound-join/cyperlink_auth`, `native-live/{guard,policy,merchant,interface}`, and `admission-review/bound-circuit`; earlier scaffold generators are not authoritative.

No new end-to-end validator/distributed replay has completed here yet. Preliminary run artifacts remain under ignored `.local/replay-admission-v1`; do not cite that interrupted run as completion. Record exact commands/results and substantive architecture changes as each slice lands. No third-party contact, real funds, public-network writes or production deployment are authorized.
