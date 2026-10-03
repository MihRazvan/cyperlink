# Generated session API card

Use your built package's `.cyperlink/bindings.mjs` and adjacent declarations.
`connectSession` is the API for this exercise; older `connect` examples use a different
manual journal lifecycle. This card supersedes those lifecycle examples for the run.
The builder writes application handlers; these are separate consent actions, not a
loop that approves and spends automatically.

```js
import { connectSession } from './.cyperlink/bindings.mjs';
const session = await connectSession({
  deployment: instance.descriptor,
  moduleRoot: instance.moduleRoot,
  endpoint: instance.endpoint,
  directory: approvalDirectory, // stable private .local path, retained across restarts
  idl: instance.idl,
  proofCli: instance.proofCli,
});
const signers = { ownerKeyfile, administratorKeyfile }; // explicit consent inputs
```

`instance.json` is local deployment configuration. Never silently use its payer path
as consent. The owner must match the selected provisioned source, and the administrator
must match policy admission. Both are explicit at preparation/staging. Paths and
account-wide private keys stay local; do not expose them in UI, telemetry or transcripts.

| Public call | Contract |
| --- | --- |
| `prepare({label, directory, provisionedDirectory, amount, consumer}, signers)` | New immutable operation plan in a fresh directory; performs real signed native preparation. Does not submit the private query. `amount` is a JS integer below 2^48. |
| `stageQuery(plan, signers)` | Explicit owner/admin query approval; SDK persists a single signing intent, exact wire and ticket. |
| `submit(plan, 'query')` | Explicitly sends/reconciles the retained query. Does not create a new query. |
| `observe(plan)` | Reads/validates account state; poll with your own bounded observation policy for the real callback. `authorized` is permission to request separate payment consent. |
| `stageCommit(plan, signers)` | Separately approved exact native payment/application effect. SDK durably retains its ticket. |
| `submit(plan, 'commit')` | Explicit submission of retained bytes; reports delivery separately from account observation. |
| `load(operationDirectory)` | Reopens retained plan with deployment/ledger checks. |
| `recover(plan, 'query' \| 'commit')` | Keyless reconciliation/discovery; no signing, simulation or onchain writes. Local metadata/cursors may be persisted. |
| `discoverApproval(plan, role)` | Finds/verifies the original ticket, including a missing application ticket after staging. No hand-edited journal path is needed. |

Merchant consumer: `{kind: 'merchant', sku: 'DECIMAL_U64'}`. Use either provisioned
asset directory returned by the instance, with its matching source-owner signer.
Two distinct sources can purchase through the same merchant consumer/policy; a source
directory's `license` label does not force the license effect. This allows competing
quota authorizations without confusing native source-prestate drift with quota drift.
License option: `{kind: 'license', productHex32, expirySlot: 'DECIMAL_SLOT'}`; the exact
product and expiry are immutable, and commit allows at most 1000 slots of validity.

Retain operation and approval directories. In a new process, connect with the same
approval directory/deployment/endpoint, `load`, then `recover`, with no signers.
An unknown delivery outcome never authorizes replacement signatures, blockhashes,
private inputs or nonces. `APPROVAL_INTERRUPTED_BEFORE_SIGNED_RECORD` blocks automatic
restaging. Explicit submit can finish a missing simulation with the original bytes;
it cannot renew expired authorization. Fresh computation is a separate owner/admin
approval after inspecting paid state, using a new operation directory.

Recovery result fields:

- `ticket.signature`/`wireSha256`: identity of the retained transaction.
- `delivery.status`, `canBroadcast`, optional `receipt`, `availability`: independent
  transport facts. Recognized uncertainty is nonbroadcastable; malformed evidence
  still throws. A JSON-RPC/application/integrity error is not automatically connectivity.
- `observation.status`: only `committed` establishes the bound paid effect. Combined
  account transport outage yields `unresolved`; it is not payment failure.
- `observation.licenseActive`, if applicable: current usability, independently of
  historical payment and receipt availability.

Genesis and ALT verification still require RPC. Recovery is not universal offline
recovery, a reservation, arbitrary provisioning repair or delegated spending.
See [receipt recovery limits](../../receipt-outage-recovery.md) for the qualified scope.
