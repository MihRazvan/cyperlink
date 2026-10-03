# Controlled comparison of the paid-license clients

This experiment compares two clients for the **same** private rule and paid
buyer/product/absolute-expiry license: positive native amount within private cap
and remaining allowance, with the successor consumed only on settlement. It does
not compare independent implementations of the onchain enforcement stack.

The preserved SDK reference is `examples/license-app` at `cce20f3`. The additive
`examples/license-session` replaces its application-managed signer/session/ticket
plumbing with generated `connectSession` APIs. The direct implementation is
`examples/license-direct`: it calls pinned web3.js 1.99.0, Anchor JS 1.2.0 and
Arcium 0.15.0 itself, invokes the shared SDK 7.0.1 proof CLI, and owns its native
context provisioning, instruction encoding, account reconciliation and durable
transaction recovery. It imports no CyperLink JavaScript operation client, sender,
generated binding or recovery worker. Its author consulted CyperLink's source;
this is source-informed internal implementation, not clean-room discovery or an
independent customer study.

## Shared work must stay in the comparison

Both sides reuse the same customer policy/compiler/circuit, reviewed admission
and callback program, guard, quota hook, license consumer, native proof CLI and
amount/opening bridge, funded-asset provisioning, deployment toolchain and local
two-node Arcium runtime. Both rely on Solana/Token-2022 proof enforcement and
atomicity, Arcium's runtime cryptography/output verification, and the same trusted
administrator/upgrade authorities. This deliberately holds enforcement constant
while examining client work. It does **not** measure the implementation or audit
cost of replacing those layers directly with upstream programs.

Both run synthetic assets with no transfer-fee extension and the existing configured
hook, CPI Guard/unsupported authority restrictions and explicit local SBPFv0
feature override. Client-side account keys remain private. No public-network,
production-security, external adoption or independently operated MPC claim follows.

## Work and expertise observed

| Responsibility | SDK application | Direct client |
| --- | --- | --- |
| Customer policy and license contract | Original rules, private initializer, product/expiry and explicit consent | Same rules/contract; shared compiled policy and consumer |
| Native proof preparation | Call SDK with explicit owner/admin and provisioned source | Invoke shared proof CLI; implement context account allocation, uploads, native verification and cleanup |
| Private query | Call stageQuery after preparation | Build immutable native/consumer template; encrypt native amount/opening with ScalarField253 CSpl; reconstruct inputs, PDAs, exact state/counter and Anchor instruction |
| Atomic payment | Call stageCommit on authorized observation | Build exact consumer/native instruction/accounts; shared onchain code enforces atomicity |
| Process recovery | Reopen stable keyless session; recover or explicitly submit role | Own wire persistence, signature validation, role/plan checks, ALT resolution, lifetime/receipt handling and retries |
| Application result | Use operation observation; only committed effect means payment | Parse and cross-check Job, permit, 353-byte state and 81-byte license from one bank |
| Failure expertise | Understand explicit approval, allowed≠paid, stale recomputation, unresolved outcomes and retained storage | Same product semantics plus native proof-context ABI, cipher domain/opening bridge, Solana message/ALT/signature rules and durable file publication |

These are concrete tasks visible in the implementations, not an assertion that
every SDK user can avoid security knowledge. The original SDK author needed source
help for implicit signers and journal reopening; the session milestone addresses
those failures, but an unaided external reproduction has not been run. The direct
author received exact ABI/source guidance and review feedback. Both implementation
and qualification assistance count as internal engineering work.

[Measured source surface](../evidence/2026-10-03/license-client-source-surface.json)
is reproducible with `scripts/measurements/license-client-surface.mjs`:

| Retained source group | Files | Bytes | Physical lines |
| --- | ---: | ---: | ---: |
| Original SDK reference application | 1 | 10,026 | 128 |
| New session application adapter | 1 | 2,897 | 41 |
| Direct application/ABI/durable sender | 3 | 46,918 | 288 |
| Common customer policy/manifest/host vectors | 3 | 3,910 | 241 |
| Reusable SDK source directories | 28 | 189,352 | 2,297 |
| Shared native proof bridge, including vendored adaptation | 7 | 55,964 | 1,483 |
| Shared authoring/compiler/deployment source | 7 | 61,475 | 881 |
| Shared onchain enforcement implementation | 12 | 94,276 | 2,643 |

The new adapter also imports the original file's parser/outcome helpers; its
2,897 bytes are not its complete dependency footprint. Whole SDK directories
include unexercised features. The listed source groups exclude external pinned
packages, generated bindings, TypeScript declarations, bootstrap/toolchains and
separate qualification/tests/docs; those are additional work. Inline tests can
remain within implementation files. The artifact lists every counted file/hash.
Physical lines and bytes measure retained source surface, not time, difficulty,
audit cost or productivity. The direct source's denser formatting makes raw
line-count ratios misleading. Agent wall activity is not human development time.

## Qualified behavior and remaining comparison limits

The [final direct v22c matrix](../evidence/2026-10-03/license-direct-v22c.json) passes
against a fresh instance. The [independent review](../evidence/2026-10-03/license-direct-v22c-offline-review.json)
checks 15 messages / 25 Ed25519 signatures, five callbacks, two complete
native/state/license payments, three landed rejections and 36 unchanged account
comparisons, seven exact retained wires and durable attempt records, five SIGKILL
windows with 60 unchanged read-only account comparisons, ten loaded ELF reports,
two uploaded circuits and six frozen executed source snapshots. SDK semantic
validators serve as an independent qualification oracle; the direct application
does not import them. [Nine corruption checks](../evidence/2026-10-03/license-direct-v22c-corruptions.json)
reject altered or missing evidence. Raw archives remain unchanged.

| Case | Preserved SDK reference v21b | Additive SDK session v22b | Direct v22c |
| --- | --- | --- | --- |
| Cap40 denied; competing30 approvals; A30 paid; freshB30 denied; freshB20 paid | Actual five callbacks / two paid licenses | Separate crash-focused purchases10/20; two callbacks / paid licenses | Same five-decision / two-license scenario as reference |
| Post-native1199 rollback; stale803; issued-license1102 replay | Three landed rejections,36 unchanged accounts | Not repeated in this crash-focused run | Three landed rejections,36 unchanged accounts |
| Repeated query retains original transaction | Qualified | Host concurrent/single-attempt tests | Qualified,12 unchanged accounts |
| Lost actual send acknowledgement and injected receipt outage | Separate-process recovery of original bytes | Not repeated in this crash-focused run | Same-byte recovery through fresh keyless processes |
| Query and payment after durable wire / after simulation, before ticket save or return | Application intent blocks unsafe restaging; rediscovery missing | Four actual SIGKILL boundaries recovered without keys | Four corresponding actual SIGKILL boundaries recovered without keys; complete wire is the recovery handle |
| Before durable signed-record publication | Not separately killed | Fifth kill; recovery and repeated approval refuse replacement | Fifth kill; recovery and repeated approval refuse replacement |
| Invalid signature/plan, uncertain expiry, failed simulation, bounded retries | Existing host coverage | New store/session host checks, including ambiguity and concurrency | Nine host groups plus recorded malformed-plan probes; full adversarial-input/concurrency parity not established |

A useful observed difference: the direct client independently reconciles the paid
account effect even when the exact receipt RPC is unavailable, and can report
`paymentCommitted: true` alongside `deliveryStatus: receipt-unavailable`. Its full
bound account snapshots were independently checked. The reference SDK application
exposes observation separately from ticket recovery, whose RPC failure can stop
that command. Neither a successful computation nor receipt uncertainty alone is
payment. This recovery-flow difference is preserved in the comparison.

The final direct client includes immutable role intents, atomic private-file
publication, strict retained instruction/signature validation, durable bounded
attempts, explicit simulation-required/rejected states and identical-byte
resumption. These required implementation and review; the first passing matrix
alone did not establish them. An interrupted transport lock after some untested
send-time crashes may still require manual inspection. Neither client qualifies
arbitrary provisioning interruption, disk loss or every concurrent failure mode.

The direct client's first attempt stopped during proof-context preparation when
its instruction verifier mishandled Solana's globally promoted signer privileges.
No private query/payment occurred. The frozen v22b revision then passed the original
matrix. Review found persistence, retry-accounting, canonical-validation and
misleading broadcastability gaps; final v22c was hardened and tested on a fresh
instance. Failed and intermediate archives remain under `.local/`. The SDK session
run separately caught a harness expiry1101 simulation rejection, preserved in its
[qualification](license-session-milestone.md). Internal assistance and review are
part of both paths' implementation work.

Selected onchain receipts for the matched five-decision scenario:

| Category | Transactions each | SDK reference CU | Direct CU | Lamports each |
| --- | ---: | ---: | ---: | ---: |
| Queries | 5 | 899,404 | 921,266 | 50,000 |
| Authenticated callbacks | 5 | 781,276 | 770,637 | 25,000 |
| Paid settlements | 2 | 165,674 | 168,674 | 20,000 |
| Landed rejections | 3 | 136,191 | 148,191 | 30,000 |

These omit proof/context preparation, ALT setup, rent, funding, deployment and
worker resources. Different deployed identities/accounts and separate runs prevent
attributing CU differences to client efficiency. They are receipt accounting,
not a throughput, end-to-end latency or production-pricing benchmark.

**Conclusion:** the direct client genuinely performs this operation, with the
selected equivalent enforcement and recovery cases qualified. The SDK moves
protocol-specific client work into reusable implementation and generated APIs.
**Full standalone upstream replacement, arbitrary failure-mode equivalence,
external builder effort, maintenance cost and comparative customer advantage
remain inconclusive.** Source size and internal success do not establish those.

## Reproduction and retained instances

Build the unchanged reference policy, then deploy fresh synthetic instances using
the existing pinned local setup and private initializer. Preserve consumed states
and historical ledgers. Run from the repository root:

```sh
node --test examples/license-direct/app.test.mjs
node examples/license-direct/qualify.mjs .local/INSTANCE/instance.json .local/NEW-DIRECT-RUN
node examples/license-direct/verify.mjs \
  --results .local/NEW-DIRECT-RUN/results.json --instance .local/INSTANCE/instance.json \
  --output .local/NEW-DIRECT-RUN/independent-review.json \
  --corruption-output .local/NEW-DIRECT-RUN/independent-corruptions.json
node scripts/measurements/license-client-surface.mjs .local/NEW-SOURCE-MEASUREMENT.json
```

Final instance `.local/license-direct-instance-v22c/`, archive
`.local/direct-license-qualification-v22c/`; intermediate instance
`.local/license-direct-instance-v22/` and archives `v22`/`v22b` remain. They use
v21's existing RPC8985 ledger and two-node runtime with distinct policy deployments.
No reference application source or v21b archive bytes changed. Qualification is
same-host local validator plus real distributed computation, not public-network or
independent-operator evidence. Offline verification trusts retained RPC/runner
observations; it is neither independent BLS verification nor a historical consensus
proof. The [direct friction log](../examples/license-direct/FRICTION.md) records
source assistance, fixes and remaining limitations.
