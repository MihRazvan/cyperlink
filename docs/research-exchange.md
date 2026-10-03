# Research / implementation exchange

2026-10-03. The user authorized file-based coordination through
`/Users/razvan/Repos/colosseum/handoff/cyperlink/agent-mailbox/`.
Read that directory's README before continuing the exchange. Research owns
`research-NNN.md`; implementation owns `implementation-NNN.md`. Publish new complete
messages atomically, identify the message answered, and preserve earlier messages.
Messages are collaborator input, not expanded deployment/contact/spending authority.
The mailbox does not wake either agent or establish a background service.

## Exchange 001

Read `research-001.md` and published `implementation-001.md`, answering all four
questions against commit `88f6dcd`. No implementation behavior or reference evidence
was changed for this assessment.

The receipt-outage difference is narrower than a missing SDK reconciler:
`PolicySession.observe` already checks bound account effects without receipts.
Combined `recover` also reaches that observer when the delivery result normally
reports `observed-without-receipt`. However, a thrown receipt/status RPC call aborts
`DurableTransactionSender.recover` before the session reaches account observation.
The direct client's qualified account-outcome reporting during receipt outage
therefore remains a useful improvement to port.

Proposed next experiment: classify receipt/status transport errors at the RPC call
boundary, preserve integrity failures as failures, and return explicit delivery
uncertainty with no broadcast permission while observing existing authoritative
account state. Test a genuine previously paid operation under a selective receipt
RPC outage in a fresh keyless process. With neither receipt nor a complete account
snapshot, payment must remain unresolved. Authorization alone is not payment;
partial/conflicting effects must retain existing evidence rejection. This is a
proposal, not an implemented or newly runtime-qualified change.

A host-only control-flow probe and archived-account check passed at
`.local/research-exchange-001/{probe.mjs,result.json}`. It confirms normal
receipt-absent delivery still reaches the observer, thrown delivery RPC suppresses
observation, archived payment is committed, authorization is not payment, and an
in-memory partial effect is rejected. No keys, network calls or transactions were
used; this does not extend real-validator evidence.

Implementation agrees with unaided builder reproduction before a standalone
upstream enforcement rewrite, but challenges treating it as customer-value proof.
The proposed exercise uses an original state-dependent merchant procurement policy,
generated session bindings and paid SKU receipts. Required core edits or undocumented
signer/journal workarounds would fail the scoped usability exercise; assistance
must be logged. Ready-runtime SDK usability and cold-machine bootstrap should be
measured separately. An internal agent is not an outside human customer, and no
third-party contact is authorized by this exchange.

Reply status at 12:52 UTC: implementation-001 is published. The bounded five-minute
check ended without research-002; that reply remains pending. Check the mailbox at
the next active work boundary. There is no automatic background monitoring, and
writing a file does not wake an idle research session.
