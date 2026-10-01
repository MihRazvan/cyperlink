# Two authenticated consumers

This script runs the joined local protocol through two independently compiled
reference consumers: a merchant SKU and an expiring product license. Both buy
with the **same synthetic Token-2022 mint** and compete for one private allowance.
Owner signing keys and native account decryption keys are created on the client.
All native accounts, proof contexts, permits, quota and effect records are
created by real signed instructions. The Arcium runtime supplies the MXE key and
signed callbacks; no fixture-key circuit or preauthorized permit is used.

Prepare/start a fresh `scripts/prepare_local_replay.py --fresh-native` deployment
and its isolated two-node Compose project first. Each scenario needs a separate
fresh ledger and output directory. Pass its own preparation manifest, matching
IDL/runtime circuit directory, and disposable administrator wallet:

```sh
node examples/two-consumers/run.mjs \
  --scenario conflict --out .local/demo-conflict-v4 --prefund-pdas true \
  --preparation .local/replay-consumers-conflict-v4/preparation.json \
  --module-root /path/to/staged/cyperlink_auth \
  --payer /path/to/staged/cyperlink_auth/local-test-wallet.json \
  --idl /path/to/staged/cyperlink_auth/target/idl/cyperlink_auth.json \
  --circuits /path/to/staged/cyperlink_auth/build \
  --proof-cli crates/client-proofs/target/debug/cyperlink-client-proofs \
  --rpc http://127.0.0.1:8899
```

The script verifies actual loaded ELF bytes for every deployment in the manifest
before provisioning, rejects an existing quota, and checks exact JavaScript and
runtime circuit versions. It does not start/stop containers, reset ledgers or
perform public-network writes. A failed run is preserved for inspection; do not
rerun by deleting keys or resetting its ledger.

`--prefund-pdas true` sends genuine local transfers to the predicted empty quota,
hook-metadata and consumer-record PDAs before initialization. The new deployment
must successfully initialize these System-owned prefunds. This exercises the
fix for a predictable-address availability failure without changing protocol
authority or permitting callers to provide initialized state.

`conflict` initializes quota100, proves and admits A60 and B60 at version0,
commits a forced merchant failure after native transfer and checks all five
state accounts rolled back, then commits A60 and its paid SKU. B's previously
authorized license purchase fails specifically with stale-version error803.
The consumed A entitlement replay fails1001. B explicitly prepares new proofs,
a new immutable action, a new permit and a new owner/admin signed policy query;
the real computation denies fresh60 against remaining40.

Before settlement, an honest owner-signed simulation establishes current
executability. Three actual transactions then change the destination, the
application action, and the consumer. They recompute the corresponding consumer
authority correctly so each fails specifically at the guard's binding check
(error705), with unchanged native/account/application state.

`compatible` starts its own fresh quota100, commits A40, then explicitly prepares
and computes B40 against authoritative quota version1. Both native payments and
their different entitlements commit; quota advances to version2. Remaining20 is
a **test-observer inference** from known setup/purchases, not a decryption of MXE
state. The encrypted quota bytes are captured and checked against each exact
authenticated permit successor.

The example exports reusable effect/template functions in `operation.mjs` and a
signed sender with cached address tables in `transport.mjs`. It uses the actual
client provisioning/proof APIs and `OperationReader` SDK. Each operation retains
its expected full Job template and encrypted-input hash before submission;
observation compares chain state with those locally authorized expectations.
The demo explicitly observes at `confirmed`, matching its transaction receipt
commitment. The SDK's default `finalized` observation can legitimately lag and
return `unobserved` immediately after a confirmed callback; this is not rejection.
Callback evidence must come from a successful transaction containing the exact
Job and computation. A failed duplicate finalization signature is never accepted.

`results.json` distinguishes actual validator transaction CU/fees, native proof
and account provisioning, Arcium queue/callback transactions, and callback wall
time. Distributed worker CPU/network costs are unmeasured. Raw signed receipts
and account evidence remain under the private ignored run directory. Public
initial funding and requested scenario amounts are explicitly observer disclosures.
The result is successful only when `passed:true`; source presence or syntax
checks alone do not constitute live validation.

The sender may retransmit identical signed bytes before blockhash expiry; it
never automatically changes operation identity, nonce, encrypted query or
signature. Ambiguous delivery aborts and preserves the signed wire. A previous
v3 attempt demonstrated why both delivery handling and commitment consistency
matter; its incomplete evidence is preserved separately and is not a passing demo.

```sh
node --check examples/two-consumers/run.mjs
node --test examples/two-consumers/operation.test.mjs
```

The focused host tests check ordered native/action bindings and exact successor
checks. They do not substitute for native validator or distributed execution.

On 2026-10-01, the fresh v4 **conflict** scenario completed with `passed:true`.
The real signed callbacks admitted both initial60 purchases, A's native payment
installed its SKU entitlement, B's old authorization failed803, and B's fresh
owner/admin-signed recomputation returned a signed denial. All three705 binding
attacks, post-transfer1099 rollback,1001 replay, and prefunded PDA initialization
checks passed. Quota ended at version1/counter4. The compact public record is
[`two-consumers-conflict-v4.json`](../../evidence/2026-10-01/two-consumers-conflict-v4.json);
full receipts and source snapshots remain in `.local/demo-conflict-v4`.

Compatible-v5 also passed on its own fresh ledger: A40 committed a merchant SKU,
then B40 recomputed against quota version1 and committed the paid license.
Quota finished at version2/counter3. Both records were checked again through the
SDK after the run; the public report includes a single-bank final account snapshot.
See [`two-consumers-compatible-v5.json`](../../evidence/2026-10-01/two-consumers-compatible-v5.json).
