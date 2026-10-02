# Signed local transaction recovery

`SignedInstructionSender` extracts the reference demo's transaction assembly, ALT support and simulation into the local client package. `DurableTransactionSender` provides its signed-wire journal independently of wallets. Both use pinned web3.js 1.99.0 and confirmed loopback RPC. These APIs currently have host qualification with injected RPC responses; this change alone is not new validator execution evidence.

```js
import { SignedInstructionSender, DurableTransactionSender } from '@cyperlink/local-client';

const sender = new SignedInstructionSender(localSession, async receipt => retainReceipt(receipt));
const ticket = await sender.stage('commit-operation', instructions, [owner], {
  role: 'commit', descriptorSha256, minContextSlot,
});
// Retain this JSON ticket alongside the immutable operation descriptor before submission.
await sender.submit(ticket);

// After a restart: no payer or owner key is needed to reconcile or retry an existing wire.
const recovered = await DurableTransactionSender.open({
  web3, connection, endpoint, directory: ticket.journalDirectory,
});
const observation = await recovered.recover(ticket); // Never broadcasts.
// Explicit action only; never signs, refreshes a blockhash or recomputes a query.
const retry = await recovered.send(ticket, { pollAttempts: 40, pollIntervalMs: 250 });
```

Staging signs and persists the exact wire before simulation. Large transactions may require explicit ALT creation/extension transactions during `stage`; the requested application transaction remains unsent until `submit`. After creating or extending a table, the sender waits for a finalized account read containing every required address at a context slot strictly later than its extension slot. The default wait is bounded to 240 polls at 250ms intervals; timeout leaves the application transaction unstaged. It obtains the application blockhash after this wait. The returned ticket is serializable and includes genesis, signature, wire hash, semantic role and descriptor hash. Validate it against the retained operation and independently validate the signed instruction semantics before using it as an operation-specific authorization. Role/hash metadata alone does not prove instruction semantics.

This wait addresses a distinction in pinned [Agave 4.3.0 ingress](https://github.com/anza-xyz/agave/blob/v4.3.0/core/src/banking_stage/transaction_scheduler/receive_and_buffer.rs): transaction prechecks resolve lookup addresses using the root bank. A table visible to confirmed simulation can still be unavailable there. In the v11 diagnostic, table extensions landed at slots609/610, parsing/lookup drops followed at612–641, and the same signed query finally landed646. That correlation supports the root-visibility diagnosis; the metric combines parsing and ALT-resolution errors. Waiting for finalized table activation does not upgrade transaction receipts or application observations from their explicit confirmed commitment.

Journal directories must be private nonsymlink directories beneath this repository's ignored `.local`. The journal contains public signed transactions and RPC evidence, never signing keys. Signed records, simulation records, broadcast intents and send responses are immutable, fsynced and published without overwrites. Each response records its acceptance signature or bounded error message; a missing response remains unknown after a crash. A process crash after writing a broadcast intent consumes that attempt even if no response was observed. The default journal permits at most three client RPC submissions of the identical wire across all restarts. Each request explicitly permits at most five RPC-managed retries of that same wire, restoring the previously tested local delivery setting. These are separate bounds, not a measurement of network packet count. The version2 manifest persists both limits (`maxBroadcasts`, `rpcMaxRetries`); each may explicitly be at most ten, and the RPC limit may be zero. Historical version1 journals retain their original RPC retry limit of zero; reopening never upgrades their policy. Recovery never creates a new journal or operation.

Every reopen/recovery checks the validator genesis and normalized loopback endpoint. Receipt acceptance requires the exact signed message, every verified Ed25519 signature, the retained ALT resolutions and a slot at least the retained `minContextSlot`. A status without the full matching receipt cannot establish a transaction outcome. Historical receipts are retained locally but do not substitute for current RPC reconciliation. These are confirmed RPC observations, not finality or independent state proofs.

| Status | Meaning |
| --- | --- |
| `prepared` | No recorded broadcast; the original blockhash is still valid. |
| `pending` | At least one broadcast intent exists; no matching receipt/status yet. |
| `landed` | Matching confirmed receipt has no transaction error. Application state still needs the operation reader. |
| `failed` | Matching receipt contains a transaction error. |
| `observed-without-receipt` | RPC has a signature status but no full receipt; no retransmission. |
| `expired-unresolved` | No receipt/status and original blockhash expired; no retransmission or replacement. Absence does not prove nonexecution. |
| `simulation-required` | Staging ended before a simulation result was retained; no submission. |
| `simulation-rejected` | Retained simulation differs from the explicit expected outcome; no submission. |

`canBroadcast` also becomes false when the durable client submission limit is exhausted. Recovery includes `retryPolicy` and `broadcasts` (each durable intent and its response, or null), plus the last retained send error if present. An accepted RPC response does not establish execution. `recover` may retain newly verified receipt evidence but sends no transaction. `SignedInstructionSender.submit` throws with `error.ticket` and `error.recovery` for an unresolved outcome; callers must retain both. An unexpected actual transaction error also throws, after its receipt has been retained. Expected adversarial custom errors remain explicit options.

The `record` callback receives the demo-compatible label/category/signature/bytes/slot/signaturesVerified/simulatedCU/landedCU/feeLamports/error/transaction shape. Repeated explicit submissions may report the same existing receipt; receivers should deduplicate by signature. Durable results contain a `record` field with signed wire bytes, so public summaries should select fields deliberately.

Neither API determines paid entitlements, automatically authorizes a new private-policy query, recreates a Job/permit, nor reuses or allocates a query nonce. Use the operation reader's authenticated Job/permit/quota/effect reconciliation for product status. Wallets are passed only for explicit staging. A valid query is not a reservation.
