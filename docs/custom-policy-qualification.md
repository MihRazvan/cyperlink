# Customer policy qualification

Status: live qualification in progress, 2026-10-02. This document does not yet
claim the complete custom-policy milestone. See [authoring](custom-policy-authoring.md)
for the implemented CLI and supported language, and [implementation plan](custom-policy-implementation.md)
for the required matrix.

## Completed checks

- Typed-expression compiler: checked private arithmetic/state, full native SDK7
  amount/opening commitment binding, CSpl/ScalarField253 interfaces and novel
  customer compositions. These are host/compiler results.
- Eight CLI test groups,138 other Node tests and82 Python tests pass.
- Legacy budget-only control on v19: actual merchant40 payment, entitlement,
  authenticated runtime callback, ten matching loaded ELFs and independent
  keyless reconciliation of the same signed payment. Private raw archive:
  `.local/custom-policy-budget-control-v19/`. Synthetic amounts are test-observer
  disclosures, not decryption of live MXE state.
- A generated v20 instance deployed five programs, verified those and five
  upstream dependencies against actual loaded bytes, and initialized an MXE
  through upstream signed instructions and two-node key generation. This is
  deployment evidence, not a successful custom-policy purchase.

## Preserved failures and environment qualification

V19 used the pinned Agave4.3.0 default local feature set. SIMD-0500 disallowed
new SBPFv0 deployments. No compiler version or architecture was changed.
V20 uses the explicit `--allow-pinned-sbf-v0-deployment` preparation flag, which
disables only feature `B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g` at fresh
genesis. `preparation.json` records the deviation. This is not default-cluster
or public-network parity. Existing legacy genesis programs remain unchanged.

The first v20 custom instance rejected state provisioning834 before initialization:
a shared generated-program build cache had reused native ELFs containing v19
addresses. Its loaded bytes matched the stale build, showing why that comparison
alone cannot certify build provenance. The builder now uses a separate target
for each generated workspace. Fresh rebuilt native ELFs differ from the retained
stale outputs. Failed artifacts/ledgers were not reset or relabeled successful.

## Remaining acceptance work

Both authored policies must finish real initialization and coexist on v20 with
distinct MXEs, programs and supported synthetic mints. The live matrix must then
prove rule-dependent decisions, paid native effects, full-state atomicity,
isolation/adversarial rejection, stale authorization, exact recovery and the
existing UI integration. Independent archive review and separated cost summaries
follow execution. No production-security, independent-operator or external-adoption
claim is made.
