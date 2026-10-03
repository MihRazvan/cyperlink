# Frozen builder exercise v1

Status: packaged, not run with an outside builder. This is a bounded usability/reuse
exercise for customer-authored private policies on the qualified local Solana path.
It is not evidence of demand, comparative advantage or production readiness.

Implementation baseline: `c53caffb58087de405a0126faead313127a88196`.
`freeze.json` identifies the exact package files, tooling source and selected public
API documentation by SHA256. The package identity is the SHA256 of its canonical
manifest payload. Run `python3 docs/builder-exercise/v1/verify.py` from the repository
root to verify it without building, deploying or modifying anything.

Give the builder [profile and setup](PROFILE.md), [brief and intake](BUILDER.md),
[session API card](SESSION-API.md), and a new copy of [the run record](run-record.json).
The builder writes their own policy, tests and application directory. Do not hand
over the completed license/qualification harness or walk through CyperLink core.
Generic language/API documentation is allowed. Record voluntary SDK-source inspection
as friction; it alone is not failure. The evaluator separately uses
[EVALUATOR.md](EVALUATOR.md) and existing evidence tooling.

Before a run, agree on the intake and supported task, assign a local runtime and
fresh paths, verify the freeze, then seal a copy of the task/run record with its hash.
Any change to the frozen tooling/docs produces a different exercise identity and
must not overwrite the earlier outcome. Runtime files, keys and failed outputs stay
under private `.local/` directories. No run directory or customer policy is supplied
as a completed solution in this package.

Two tracks must be reported separately:

- **Ready-runtime usability:** evaluator prepares and verifies the pinned runtime,
  dependency caches and synthetic funding. Builder authors, tests, builds, deploys
  their policy and integrates the SDK. Record setup help before the clock starts.
- **Clean-machine installation:** installation/build/download/cache/environment work
  has its own record and clock. This has not been independently qualified; do not
  call a same-machine ready-runtime success a clean-machine result.

Remaining prerequisites: a consenting outside builder, their workflow/confidentiality
rationale, a dedicated evaluator slot, and a verified ready runtime or separately
scoped installation attempt. An internal agent cannot substitute for that builder.
No recruitment, third-party contact, public deployment or paid infrastructure is
performed or authorized by this package. Arranging an outside participant is a user
step; no further core implementation is needed merely to prepare an invitation.
