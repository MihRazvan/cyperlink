# Paid-license application rehearsal

Started 2026-10-03 against `ffd23a5a5374ae9a50186fe448c29f65a22b58f7`.
Status: implementation and fresh local qualification in progress; no new runtime
success is claimed yet.

The next evidence gate is application integration, preserving the qualified
native-payment profile. An internal agent is authoring a separate application
from public repository documentation, without initially reading earlier acceptance
harnesses. This is a docs-first internal rehearsal, not an external developer,
customer commitment, blank-machine bootstrap or production qualification.

The application owns a private per-purchase cap and decreasing allowance policy,
uses generated bindings, and gates a paid product license. Source/tests live in
`examples/license-app`; secrets, generated deployment files and new evidence stay
in ignored `.local/`. Existing profiles and evidence remain intact.

Acceptance: real Arcium allow/deny callbacks; native payment plus paid license and
exact private successor; stale authorization rejection and explicit fresh
recomputation; replay and post-native rollback; lost acknowledgement and separate
process recovery of the same signed payment; unavailable receipt/RPC must not
become a false payment/failure or cause fresh authorization. Revalidate loaded ELFs
and actual uploaded circuit bytes. Label injected faults and observer disclosures.

Record setup instructions, source inspections, support interventions, core changes
and application-specific work. Compare with pinned upstream APIs using equivalent
authority, input authentication and final effects. A source/API comparison alone
is not a measured end-to-end upstream benchmark; any unfinished baseline stays
explicitly inconclusive.

The runtime will use a fresh local ledger and the already documented explicit
SBPFv0 deployment feature override. Do not reset previous ledgers or alter the
configured cryptography/dependency versions. No public-network writes or outreach.

Initial friction: the retained validator is no longer listening; Docker API calls
time out. The documented toolchain verification also rejects an upstream-generated
`criterion` cache symlink. Investigate these separately rather than weakening
verification or presenting an old execution archive as a new run.
