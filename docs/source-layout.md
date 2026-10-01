# Reviewed source import

`config/source-import.json` records original locations and byte hashes **before product edits**. The imported source is the final reviewed research implementation, not its old scaffold generators. Existing package/program names and local IDs are retained to minimize ABI drift. These IDs are local qualification identities, not a production deployment.

- `programs/auth`: immutable action/Job, permit assignment, Arcium callbacks. Copied historical lockfile; unused example encrypted-ixs workspace member removed. `build/` contains only the two pinned runtime circuits and schemas required by Arcium macros.
- `programs/native`: settlement guard, quota/admission hook, merchant and common operation ABI. Fixture generator excluded from this program workspace; historical lockfile preserved initially.
- `circuits/budget`: runtime-key commitment-gated compiler source and its historical lock. Explicit fixture-key mock is deliberately not in the runtime package.
- `crates/native-admission`: new strict admission checks, shared across queue and native settlement.

Direct dependency constraints are tightened to exact versions already present in the imported locks. No version upgrade is intended. Cargo may prune unused workspace dependencies; review lock diffs and use locked builds afterward. Generated build caches, ledgers, signing identities and new experiment output stay ignored.

The existing fixed quota, fixed hook metadata and preallocated permit accounts remain qualification limitations. Source import alone does not complete account provisioning or the SDK.
