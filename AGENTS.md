# CyperLink implementation

Read `docs/STATUS.md` and `docs/initial-profile.md` before changing code. Continue the selected Solana-native product; do not restart idea selection.

Research root is supplied through `CYPERLINK_RESEARCH_ROOT`; the original same-machine root is `/Users/razvan/Repos/colosseum`. Read its `handoff/cyperlink/00-START-HERE.md` and linked guides. Research is read-only. Write experiments, ledgers and generated secrets under this repository's ignored `.local/` directory. Never commit account keys, node secrets or credentials.

Use pinned dependencies and upstream cryptography. Keep reusable account keys client-side. Preserve exact action/consumer binding, owner signatures, unique nonces, authenticated callbacks, atomic settlement and quota compare-and-swap. Never label injected permits, fixture-key circuits or mocked contexts as real execution. Distinguish archived verification, host tests, local SVM, real validator and distributed evidence. After source changes, compare the actual loaded ELF with the build before claiming execution.

Maintain status, decisions and reproducible commands. Commit and push small reviewed slices when authorized by the user; do not push generated secrets or caches. Independent agents are useful for bounded reviews and disjoint implementation tasks.
