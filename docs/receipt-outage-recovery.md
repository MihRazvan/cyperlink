# Receipt-outage recovery

2026-10-03. This bounded change follows research-002 in the authorized agent
mailbox. The reference license application, policy/circuit/program bytes, existing
journals and prior qualification archives remain intact. Dependency pins are unchanged.

`PolicySession.recover(plan, role)` now separates typed receipt/status transport
unavailability from integrity failure, then uses the existing bound account observer.
`delivery.availability` contains only method/category/status/code, never RPC bodies,
URLs, keys or signed bytes. A receipt-null response is distinct from failed transport.
`delivery-unavailable` cannot broadcast; a status-only result may instead be
`observed-without-receipt`, also nonbroadcastable. An explicit submit stops when it
encounters transport uncertainty, including a one-shot outage.

A committed account observation establishes the paid application effect under the
qualified program/RPC trust assumptions. It does not establish that a particular
retained signature landed. No receipt is manufactured. If account transport is
also unavailable, recovery returns `observation.status: 'unresolved'`. An authorized
unconsumed permit remains authorization, not payment. Malformed RPC JSON/shapes,
conflicting effects, stale snapshots, altered plans/signatures/lookup resolutions,
wrong ledgers and corrupt journals still fail closed.

The minimum observation slot includes the plan, signed record, validated retained
receipts, prior recovery cursor records, current status context and current receipt.
Successful recovery observations persist their slot in create-only, wire/ledger-bound
local cursor records. The maximum survives process restart. `delivery.observationSlot`
is the floor supplied to the account observer; `observation.slot` is its later
successful snapshot. Read-only means no onchain writes: discovery, receipts and
context records can be durably written locally. Concurrent recovery can conservatively
reject an observation overtaken by a newer retained slot. The existing 4096-file
approval discovery bound remains; no compaction/background journal service is added.

The fetch boundary recognizes allowlisted Node network failures/timeouts and HTTP
408/429/500/502/503/504. JSON-RPC application errors, arbitrary exceptions, unrecognized
transport errors and decoder errors remain hard failures. This is deliberately not
a general offline mode: genesis and retained ALT verification still need RPC access.
Only the opt-in session installs this availability boundary; legacy reference APIs
are not newly qualified for transport-error fallback.

## Evidence and limits

[Qualification summary](../evidence/2026-10-03/license-session-receipt-outage-v23b.json)
records three fresh keyless processes using generated `connectSession` bindings
against the genuine second paid v22b license on the existing local validator:

| Injected fault | Delivery | Account outcome |
| --- | --- | --- |
| Receipt HTTP503 | `delivery-unavailable` | `committed` |
| Receipt/status/account HTTP503 | `delivery-unavailable` | `unresolved` |
| RPC restored | `expired-unresolved` | `committed` |

The local validator has pruned the original receipt and signature status. Restored
RPC returns null; this run cannot qualify retrieval of that historical receipt.
A host test separately qualifies outage followed by an exact matching receipt. Do
not conflate it with the live test. No new payment or Arcium computation was run.
The original v22b archive still establishes the earlier native settlement/callback.

All six Job/permit/quota/effect/source/destination account records remained unchanged.
The original journal and all copied original records stayed byte-identical. All
three processes retained the same signature/hash/attempt count. RPC allowlisting
forbade signing-related RPC, simulation and broadcast; no signer configuration was
supplied. Ten actual loaded ELFs matched existing build bytes. There were no new
onchain transactions or production/public-network actions.

The initial v23 run is retained as failed: its test allowlist omitted the read-only
blockhash queries needed when restored RPC returned null. The corrected v23b run
permits those reads and explicitly records the pruned-receipt limitation.

Host validation: 106 SDK/policy-client/local-client tests passed, followed by one
additional exact-receipt-restoration test in the passing 15-test sender suite.
Focused tests include one-shot uncertainty, status-only and cross-restart floors,
legacy receipt floors, malformed responses, conflicting effects and unchanged
broadcast behavior. These are host tests, separate from live account reads.

Reproduce on a ledger retaining the supplied paid operation (new output required):

```sh
node examples/license-session/receipt-outage.mjs --qualify \
  .local/license-session-instance-v22/instance.json \
  .local/license-session-qualification-v22b/second \
  .local/NEW-RECEIPT-QUALIFICATION
node --test packages/local-client/test/*.test.mjs packages/policy-client/test/*.test.mjs packages/sdk/test/*.test.mjs
```

Raw current evidence: `.local/license-session-receipt-outage-v23b/results.json`.
The harness copies journals into its own private directory; it never modifies the
reference operation or its approval records. Reproduction needs the live local
ledger and existing archives; cold-machine bootstrap remains a separate exercise.
