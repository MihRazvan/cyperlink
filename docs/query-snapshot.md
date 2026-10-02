# Owner-authorized query snapshot

`runtimeBudgetBound` now ends with two arguments: `expiry: u64` and
`expectedQueryState: [u8; 32]`. Both the source owner and configured administrator
sign the transaction containing this expectation. Compute it as:

```text
SHA256(UTF8("cyperlink-query-state-v1") || quota_account_data[0:96])
```

The byte range commits to quota version, current state hash, encryption nonce,
current ciphertext and allocated-query counter. The fixed quota address, account
owner, administrator and idle transient routing pointer are checked separately.
The program compares the signed digest with the quota account in the transaction
before allocating the next nonce or queuing private computation. A mismatch
returns `QueryStateChanged` (custom error 6004). Anchor may attempt account
creation before entering the handler; transaction rollback ensures rejection
leaves no Job, permit claim or counter allocation behind.

This closes a client staging race: a competing query changes the counter without
changing the consumed allowance; a settlement changes the encrypted shared state.
Neither can silently redirect an already signed query to a different snapshot.
Two competing operations remain possible: explicitly stage and sign each query
against the current snapshot, including its then-current counter. Admission
still grants no reservation, so subsequent settlement can make an authorization
stale.

A durable client must persist this digest, the exact encrypted input bytes,
computation offset, immutable action and permit addresses before submission.
After an ambiguous send, recover the original operation and signed transaction.
Do not replace the digest, allocate another Job or re-encrypt inputs as an
automatic retry. A fresh snapshot requires an explicit new query authorized by
both owner and administrator. Queries that genuinely landed can be reconciled
from their immutable Job; a local predicted nonce is never evidence of admission.

This change adds one instruction argument and error variant. It preserves all
account layouts, native validation, permit assignment, callback verification,
quota consumption and consumer binding. The initializer is unchanged. Old
clients must rebuild against the new IDL; old ELF results remain historical
evidence and do not validate this boundary.

Host tests cover exact acceptance, competing-query counter drift, settlement
state drift, domain separation and malformed layout. They do not prove runtime
rollback. Qualification requires rebuilding and checking the actual loaded Auth
ELF, then an owner/admin-signed stale-query rejection with unchanged quota,
absent Job and permit claim, and no queued computation, followed by an explicitly
fresh authorized query.

Qualified in the final conflict-v15 run: the actual loaded rebuilt Auth ELF
matched; a retained owner/admin-signed query rejected 6004 after another query
advanced only the counter. Two existing accounts stayed unchanged, and its Job,
permit claim and computation stayed absent. The later explicitly fresh B query
received an authenticated denial. See the [recovery archive review](../evidence/2026-10-02/sdk-conflict-v15-recovery-review.json).
