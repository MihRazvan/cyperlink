# Direct client implementation accounting

This is an internal source-informed implementation, not an external builder study
or a clean-room implementation. The author was explicitly assigned a bounded client
baseline and told it could share the reviewed CyperLink enforcement. No external
support contact was made. Parent-agent coordination supplied scope and will supply
fresh runtime/assets; live author troubleshooting must be counted as internal help.

Sources inspected before/while implementing:

- `AGENTS.md`, `docs/STATUS.md`, `docs/initial-profile.md`, the upstream comparison,
  research handoff/start and architecture invariants.
- Reference app `app.mjs` and `README.md`; it was preserved unchanged.
- `packages/policy-client/src/{operation-client,operation-plan,prepared-action,
  deployment,sdk,codec}.mjs` and `packages/sdk/src/{builders,codec}.mjs` to understand
  exact existing ABI and semantics. `abi.mjs` reproduces/adapts those known layouts,
  bindings and reconciliation checks. Count that as CyperLink source assistance,
  not independent discovery of an upstream application protocol.
- `packages/local-client/src/{runtime,prepare-transfer,proofs,transaction-sender}.mjs`
  for native CLI contract, proof upload format and the known finalized-ALT ingress
  requirement. The direct sender/application reimplements these operations rather
  than importing them. This knowledge transfer is an advantage to the direct author.
- Installed Arcium `build/index.mjs`: exported CSpl cipher/key/PDA APIs and
  `awaitComputationFinalization`; Anchor `provider.js` raw confirmation retries.
  Both upstream HTTP polling and identical-byte retry already exist; neither is
  credited as missing in upstream. Direct recovery adds application persistence,
  validation and account-effect checks around those upstream primitives.
- `crates/client-proofs/Cargo.toml`, shared Auth callback verification sites and
  license error1199 to confirm native version and common enforcement boundary.

App-specific work implemented here includes strict CLI approvals, private file and
wire persistence/fsync, signed-message verification, same-byte recovery, dynamic
ALT setup/root visibility, proof context creation/upload/verification, exact immutable
native/license template building, CSpl amount/opening encryption, snapshot-bound
queue, single-bank Job/permit/quota/license reconciliation and atomic commit builder.
The shared Rust proof CLI, policy compiler/circuit, on-chain programs, runtime
bootstrap and funded-native provisioning must be counted separately on both sides.
Do not divide reference app line count by this direct client and call that a measured
saving: the two clients delegate different amounts of work to shared code.

Initial integration findings and limitations:

1. ABI details (353-byte quota, 712-byte permit, 1200-byte Job/action, exact input
   digest and license semantic offsets) required reading CyperLink source. These
   are application-specific integration requirements, not generic Arcium flaws.
2. The native CLI's public prepared-transfer output defaulted to0644 while the
   witness was0600. Direct code sets the prepared file0600 before private-file
   loading. Reusable confidential keys stay only in the provisioned client files.
3. ALT setup must reach a rooted bank before signing large application messages;
   this was already documented by the reference implementation and was reused as
   knowledge. A fresh table for each large role adds setup transactions/fees.
4. Repeated commands need unique setup journal names. They now use UUID suffixes
   while role-wire paths are fixed and create-only. A process death during staging
   can leave a lock; a complete fixed role wire remains recoverable without keys.
5. Callback polling is performed through direct single-bank account observation,
   not a new callback authentication implementation. On-chain callback authentication
   remains the shared Arcium macro/output verifier plus reviewed CyperLink bindings.
6. App authoring elapsed activity, when reported, is agent wall activity only. It
   cannot estimate human productivity, developer salary, production maintenance or
   customer preference. Source bytes/physical lines and generated-artifact evidence
   are recorded under ignored `.local/direct-license-authoring/`.

Final bounded evidence: the hardened v22c run passes five real callbacks, two paid
licenses, three landed adverse transactions, actual lost acknowledgement and five
SIGKILL windows. Its raw results/source copies are in
`.local/direct-license-qualification-v22c/`; independent review and nine corruption
checks are beside them. Nine host tests remain separate from that real execution.
The full standalone enforcement alternative and all broader failure-mode parity
remain inconclusive.

Additional implementation defects and internal assistance are retained:

7. The first direct attempt v22 failed during proof-buffer close because the wire
   verifier compared per-instruction flags against decompiled global payer privilege
   promotion. No query or payment occurred. The verifier now reconstructs the entire
   expected v0 message and compares exact serialized bytes. The failed archive and
   its already-created native contexts are preserved; v22b used unchanged balances.
8. Initial v22b genuinely paid/recovered but lacked durable maximum-attempt accounting,
   complete simulation/ALT/context validation and sufficient file/plan strictness.
   Parent and an independent internal reviewer identified those differences. The
   author fixed them before v22c, with a fresh policy/native deployment. The earlier
   pass is not evidence that the later code was executed.
9. Review also found permissive malformed-plan decoding, reuse of a role wire before
   full validation, incomplete approval-intent persistence, and misleading readonly
   `canBroadcast` states. They are corrected in the frozen v22c client. Five reported
   malformed-plan mutations now reject; signatures, exact wire, simulation, intent,
   ledger and storage path are validated before role reuse. Source-aware internal
   review assistance must be counted on this side of the comparison too.
10. Atomic create-only file installation uses an fsynced temporary file, hard link,
    parent-directory fsync and cleanup. Real SIGKILL tests target that boundary.
    An orphan temporary file or pre-wire permanent intent does not become permission
    to create a replacement transaction. Recovery of arbitrary damaged disk state
    remains outside this bounded claim.
11. Qualification reuses the reference fault-preload protocol and shared
    snapshot/callback/archive helpers as explicitly labeled test infrastructure.
    The independently authored verifier also uses the SDK as a semantic oracle.
    Neither is imported by runtime `app.mjs`, `abi.mjs` or `wire.mjs`.

The final run took208.247 seconds of local qualification wall time, including
process restarts and injected receipt waits. This is not developer effort or an
isolated latency benchmark. `.local/direct-license-authoring/final-measurements.json`
separates native proof generation/context setup, per-invocation wall time, callback
observation time, and transaction/CU/fee totals. It counts111 distinct transactions
including native/application/ALT setup and the final unsubmitted-operation crash
probe; it excludes shared deployment and initial funded-asset provisioning.
Preparation and crash probes deliberately add work, so compare like-for-like
categories before inferring any application cost difference.
