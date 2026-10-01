# Implementation status

Updated 2026-10-01. This repository continues the completed research; historical evidence is preserved in the original research root.

## Proven baseline and limits

The final `bound-join` research run verified genuine native proofs and owner signatures, two-node Arcium runtime keys and signed outputs, immutable Jobs and unique permit claims, restricted callback admission, and atomic native transfer / encrypted quota advancement / merchant entitlement. The circuit gates policy disclosure against the native grouped amount commitment. Loaded ELF and transaction/account evidence were independently checked in that research run.

The historical research queue did not validate every equality/range/grouped/account/funding relationship before disclosure; the implementation now shares that validation between queue and settlement. Two consumers were tested with staged admission in a separate SVM harness; only the merchant joined the final live path. Portable provisioning, fresh two-consumer recomputation, recovery, production security, external demand and comparative customer advantage remain unproven. Historical tests are not new executions in this repository.

## Implementation sequence

1. Establish reproducibility: verify archived provenance, import only reviewed source and pinned lockfiles, isolate new run outputs, build and validate loaded binaries.
2. Complete admission: share a strict no-fee native validator across queue and settlement where possible, reuse upstream proof extraction, reject inconsistent verified proof sets and unsupported profiles before allocating computation. Preserve circuit commitment gating. Specify authorized-query semantics in `initial-profile.md`.
3. Client provisioning/lifecycle: local mint/accounts and proof buffers, client-owned witnesses, explicit operation IDs/status/recovery, no manually injected authorization. Read Job, permit and committed consumer effects together.
4. Authenticated two-consumer demo: competing 60+60/100, stale rejection, fresh 60/40 denial, recomputed 40+40 success, changed recipient/action/consumer, replay and post-transfer rollback. Separate public and test-observer output.

## Current work

- Archived verifier passes: 46 pinned artifacts; 14 corruption/semantic tests. No original evidence changed. Imported auth initially rebuilt to the exact historical ELF `cedff496…c782a0`.
- Shared strict native validator runs before queue and at settlement. Twelve host test groups recheck six genuine proof payloads and reject inconsistent contexts, accounts, funding and profiles. Four routing tests use the actual upstream metadata resolver.
- **Fresh admission/routing replay passed** on a real Agave validator and two fresh Arcium nodes: nine signed malformed queues rejected before computation; three mismatched encrypted witnesses returned false through authenticated callbacks; native payment, quota advancement and merchant effect committed atomically; forced application failure rolled everything back; stale, replay and cancelled operations failed. Actual settlement used 80,818 CU, separate from proof verification, queue and MPC. See [`admission-routing-v2.json`](../evidence/2026-10-01/admission-routing-v2.json). This run used preserved synthetic native genesis assets and quota; it is not fresh provisioning evidence.
- Client library/CLI now creates persistent client-only ElGamal/AES keys, provisions confidential accounts with real native pubkey proofs, prepares fresh transfer proofs, uploads large proofs through a signer-controlled buffer, and checks the actual signed landed transaction. Ten real provisioning transactions on the v2 ledger succeeded; four host proof lifecycle groups and seven client groups pass.
- Lifecycle SDK distinguishes queued, authorized, stale, denied, expired, cancelled and committed operations using one consistent account batch and retained bindings. An authenticated callback alone is never a paid entitlement. Merchant and license adapters now have twelve host groups passing.
- Current v3 qualification starts with **only 61 Arcium runtime genesis accounts**. Native mint/accounts, proof contexts, permits, quota, metadata and consumer records are created through signed instructions. All six loaded implementation ELFs matched their staged builds. Real quota provisioning and encrypted initialization, native account/proof setup and merchant record creation succeeded. The conflict demo is investigating an unresolved first queue receipt; it has not yet passed. Preserve `.local/replay-consumers-conflict-v3` and `.local/demo-conflict-v3`.
- Provisioning adversarial checks on v3 passed: nine genuinely signed negative simulations and three actual buffer create/write/close transactions with byte and rent checks. No demo quota or token account was changed by that test.
- Reproducibility remains same-machine: the original pinned validator, installed JS dependencies, cached Docker images and circuit artifacts are read-only inputs. Clean-machine bootstrap and circuit rebuild are still outstanding.

## Decisions after source inspection

- Full current executability includes hook account resolution. The old metadata fixes one permit per source, which cannot support honest fresh operations while retaining permanent PermitClaim assignment. The selected replacement appends an active-permit pointer to quota (129 → 161 bytes), set only during G-authorized arm and cleared by atomic hook consumption. Metadata resolves quota then this pointer; queue and guard must validate its exact schema. Permanent per-operation claims remain.
- The current deployment replaces the historical genesis quota key with the canonical H `["quota"]` PDA. Auth checks its actual upgrade authority before selecting the administrator; H creates the quota via the admission PDA. Encrypted initialization still requires a real signed MPC callback. Canonical metadata and blank consumer records are also created on-chain. This requires a fresh deployment and is not a migration of historical accounts.
- JavaScript Anchor actually resolves to **1.2.0** in the archived lock/install; Rust Anchor and IDL binary are **1.0.2**. Preserve both exact versions rather than treating the original JavaScript semver lower bound as its installed version.

## Continuation and evidence

Start from this file, `initial-profile.md`, then the original `handoff/cyperlink/` guides 01–06 and canonical `CYPERLINK.md` sections 1, 6–18, 22–24. The latest source is `research/cyperlink-prebuild-2026-10-01/bound-join/cyperlink_auth`, `native-live/{guard,policy,merchant,interface}`, and `admission-review/bound-circuit`; earlier scaffold generators are not authoritative.

The interrupted `.local/replay-admission-v1` remains diagnostic evidence only. Completed v2 evidence and the in-progress v3 ledger are separate; do not conflate their deployed bytes, fixtures or costs. Record exact commands/results and substantive architecture changes as each slice lands. No third-party contact, real funds, public-network writes or production deployment are authorized.
