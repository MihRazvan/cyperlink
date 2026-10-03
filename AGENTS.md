# CyperLink development

Read `docs/STATUS.md` and `docs/architecture.md`. The selected product is programmable
privacy infrastructure for Solana, with customer-authored policies and explicit
human approval. Do not restart idea selection or treat the separate Permissions
experiment as supported delegated policy execution.

Current developer instructions are in `docs/custom-policy-authoring.md` and
`docs/local-bootstrap.md`. Update the current guides/status when behavior changes;
do not add another milestone, plan or narrative report for every work session.
Put public machine-readable qualification reports in `evidence/` and index material
new guarantees/limits in `docs/evidence.md`.

Use pinned dependencies and upstream cryptography. Keep account decryption keys
client-side. Preserve native/action/consumer binding, owner/admin authorization,
unique nonces/permits, callback authentication, atomic effects and quota version checks.
Never present mocks, fixture-key circuits, staged permits or injected verified contexts
as real execution. Distinguish host tests, simulation, local validator, distributed
computation and public-network evidence. After runtime source changes, compare actual
loaded ELF bytes with the build before claiming execution.

Write new experiments, ledgers and secrets under ignored `.local/`. Preserve original
fixtures, archives and failed runs. Never commit keys or credentials. The original
research root (`CYPERLINK_RESEARCH_ROOT`, usually `/Users/razvan/Repos/colosseum`) is
read-only except the user-authorized agent mailbox; consult it for specific unresolved
questions, not as a mandatory onboarding detour. Follow that mailbox's exchange protocol.

The accepted builder exercise and historical narrative docs are preserved at tag
`builder-exercise-v1`; see `docs/builder-exercise.md`. Do not silently change its freeze.
No third-party contact, real funds, public-network writes or production deployment
is authorized. Continue reversible local work and push small reviewed slices as
requested. Independent agents may handle bounded reviews or disjoint work when useful.
