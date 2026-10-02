# Customer-authored private policies — implementation plan

Requested October2,2026; supersedes the previous next-work ordering. Baseline
`0201b34` remains qualified. Research inputs are the custom-policy implementation
prompt/research/direction and retained authoring probes in the read-only frontier
research directory. This document records implementation decisions. The resulting bounded local
path now passes; see [actual qualification](custom-policy-qualification.md).

## Compiler and authoring contract

First gate: inspect and execute pinned0.15 field/cipher integration checks. The
research high-level BaseField255 authoring result and ScalarField253 native-bound
IR result are separate. Unless a defensible same-computation high-level bridge is
shown, use a typed Rust expression API over the already qualified ScalarField
compiler. No unchecked second amount, plaintext handoff, truncated opening or
verifier downgrade is permitted.

A package declares1–4 named privateu64 state fields and customer Rust expressions
over those fields and the authenticated native amount. The initial public input
adapter supplies only the exact native amount/commitment relationship; additional
asserted external facts are unsupported. Checked arithmetic, comparisons, Boolean
composition and selection compile into MPC logic. Arithmetic errors anywhere in
the expression graph deny the operation, including unselected branches. Platform
checks and the customer's Boolean are ANDed; denied operations preserve state.
All4 padded state slots are encrypted; undeclared slots must remain zero.

Private initialization values come from a client-owned ignored local file, never
a public package manifest. Source constants are public. Build execution is trusted
local Rust code, not a hostile-code sandbox or proof of policy noninterference.

## Package and deployment

New `policy init/build/test/deploy` tooling generates circuit wrappers, artifacts,
release manifests and typed bindings. Canonical hashes include schema, customer
source, compiler/platform provenance, interfaces and circuit artifacts; absolute
execution paths are excluded from identity. Release hashes exclude configured ELF
hashes to avoid a circular hash dependency; deployment records bind actual program
identities and loaded bytes separately.

A deployment gets fresh Auth/H/G/merchant/license IDs; the interface kernel is G.
It uses a distinct Auth-owned MXE/key domain on the same two-node local cluster.
A separate synthetic mint hooks to each H. Same-mint multi-policy routing and
independent operators are not claimed. Existing native proof-buffer code is reused.
Local tooling builds and deploys programs, registers/uploads circuits and initializes
real state through signed instructions. Partial deployment is retained and labeled;
arbitrary interrupted deployment recovery or state migration is unsupported.

The existing pinned v0 localnet setup remains intact. New policies are deployed to
that loopback ledger through a separate manifest-aware path. Two customer releases
must coexist. Fresh releases/instances replace upgrades; program upgrade authority
is explicitly trusted and never represented as frozen by a circuit digest alone.

## Versioned ABI and authority

New profile `local-custom-policy-v1`:353-byte state and712-byte permit. Preserve
active-permit routing at state offset129. Additional ciphertexts and release/schema/
domain identities occupy fixed appended fields. Hash the complete nonce/ciphertext
state and its identity. The permit retains the complete proposed successor. The
business state advances only with native transfer and the exact consumer effect;
queue counters remain separate and signed queries bind the full current snapshot.
Historical v0 accounts/readers/artifacts are not migrated or reinterpreted.

Initialization and code/state access require the configured owner's authority.
Queries retain explicit source-owner/admin approval; settlement retains the owner
signature. Computation IDs, definitions, MXE, release/schema/domain, native action,
consumer, predecessor and successor are bound through queue/callback/commit/recovery.
Each new computation is a new authorized disclosure; retries only reuse exact signed
bytes. Initialization and query successor nonces share one nonrecycled MXE domain.

## Reviewable implementation slices

1. Compiler gate and typed authoring library with executable arithmetic/binding tests.
2. Versioned native/Auth profile and generated deployment configuration.
3. Package CLI, canonical manifests, artifact validation and generated client bindings.
4. Manifest-aware lifecycle/reader/ticket recovery, preserving legacy entrypoints.
5. First budget-plus-count customer; freeze the authoring core, then independently
   author minimum-reserve through the documented API without core name branches.
6. Real two-package ledger qualification and minimal selected-policy display in
   Approvals; safe reports, source/ELF/circuit provenance and offline review.

## Acceptance matrix

- Build: novel source/schema, distinct changed artifacts/releases, tamper/malformed
  schema/unsupported expression rejection, integer bounds and all-branch overflow.
- Real rules: count4→5 allows once then denies while funds remain; private reserve
  denies a payment budget-only would allow. Include budget-only compatibility.
- Binding/isolation: native amount/opening, wrong cipher, owner/admin, unsupported
  native profile, initialization/reinitialization, release/schema/state/MXE/definition,
  callback association and transplanted permit rejection.
- Lifecycle: allowed callback leaves full business state unchanged; denied/expired/
  cancelled/stale do not consume capacity; predecessor competition and counter-only
  delayed-query rejection occur before new MPC work.
- Atomicity/replay: native transfer followed by forced consumer failure rolls back
  fullstate/tokens/permit/effect; exact action/consumer, callback/commit replay,
  successor length/content and descriptor substitution fail.
- Recovery: lost acknowledgement, restarted keyless observer, identical retained
  transaction, no duplicate spend/new signature/private query; legacy reads preserved.
- Evidence: actual signed landed negatives and raw application-account snapshots;
  all loaded ELFs, registered artifact/interfaces, signatures and offline review;
  compilation/proofs/provisioning/queue/callback/commit costs separated. Host tests,
  local SVM and real distributed execution are distinct evidence classes.
