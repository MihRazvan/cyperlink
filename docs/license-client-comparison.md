# Controlled comparison of the paid-license clients

This experiment compares two clients for the **same** private rule and paid
buyer/product/absolute-expiry license: positive native amount within private cap
and remaining allowance, with the successor consumed only on settlement. It does
not compare independent implementations of the onchain enforcement stack.

The preserved SDK reference is `examples/license-app` at `cce20f3`. The additive
`examples/license-session` replaces its application-managed signer/session/ticket
plumbing with generated `connectSession` APIs. The direct implementation is
`examples/license-direct`: it calls pinned web3.js1.99.0, Anchor JS1.2.0 and
Arcium0.15.0 itself, invokes the shared SDK7.0.1 proof CLI, and owns its native
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
| Application result | Use operation observation; only committed effect means payment | Parse and cross-check Job, permit,353-byte state and81-byte license from one bank |
| Failure expertise | Understand explicit approval, allowed≠paid, stale recomputation, unresolved outcomes and retained storage | Same product semantics plus native proof-context ABI, cipher domain/opening bridge, Solana message/ALT/signature rules and durable file publication |

These are concrete tasks visible in the implementations, not an assertion that
every SDK user can avoid security knowledge. The original SDK author needed source
help for implicit signers and journal reopening; the session milestone addresses
those failures, but an unaided external reproduction has not been run. The direct
author received exact ABI/source guidance and review feedback. Both implementation
and qualification assistance count as internal engineering work.

Source-size measurements will separate application adapters, reusable SDK modules,
shared native/enforcement code and qualification code. Physical lines and bytes
measure retained code surface, not time, difficulty, audit cost or productivity.
The direct source's denser formatting makes a raw line-count ratio misleading.
Agent wall activity is not a measurement of human development time.

## Qualification status

The SDK reference v21b has five authenticated decisions, two actual paid licenses,
post-native1199 rollback, stale803, replay1102, exact query reuse and keyless recovery
after actual send-acknowledgement loss and injected receipt outage. The additive
session v22b also qualifies four real signed-record/simulation-to-ticket SIGKILL
boundaries and one refusal to replace an interrupted attempt without a durable
signed record. See [session evidence](license-session-milestone.md).

The first frozen direct-client matrix v22b also executed five genuine decisions,
two paid licenses, the three landed rejection causes and acknowledgement/receipt
fault recovery. Its first v22 attempt stopped at preparation when a verifier
incorrectly treated Solana's promoted signer flags as distinct instructions; the
fix compares entire reconstructed signed messages. Those failed records remain.
A review then identified client persistence/retry/validation differences; the
baseline is being strengthened and requalified. That passing intermediate matrix
is not evidence that the final direct recovery contract already has parity.

**Current conclusion: full equivalent-client comparison is inconclusive.** A real
direct client can perform the operation using the shared enforcement, and the SDK
packages client work it had to implement. That establishes feasibility, not a
comparative customer advantage. Independent enforcement, full adverse-input parity,
external builder effort and production maintenance remain unmeasured.
