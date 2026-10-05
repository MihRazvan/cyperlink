# CyperLink Console

The local project workspace for customer-authored private policies: prepare a payment
intent, explicitly approve its private query, separately approve settlement, and inspect
or recover the original delivery. The browser uses the generated `PolicySession` API
through a local server. It does not implement another payment or cryptography path.

## Connect a completed local deployment

First [set up the pinned runtime](../../docs/local-bootstrap.md), then
[build and deploy your policy](../../docs/custom-policy-authoring.md). Console requires
a completed `local-custom-policy-v1` instance with its validator and Arcium services
running. It does not initialize, build, deploy or repair a partial deployment.

From the repository root, start without signing keys to inspect a new or retained
workspace:

```sh
node packages/policy-cli/cyperlink.mjs console \
  --instance .local/my-instance/instance.json \
  --directory .local/my-console \
  --port 4321
```

Open **http://127.0.0.1:4321** directly. The server binds only to loopback and accepts
its exact local host/origin; `localhost` is not the configured address. Startup checks
deployment/release identity, generated bindings and circuit artifacts, and compares
actual loaded program ELF bytes with the retained build.

Use a separate Console directory under ignored `.local/`, outside the deployment
archive. Keep that same directory across restarts: it contains the operation history,
SDK approval journal and retained delivery records. It is bound to the selected
deployment and ledger. Only one Console process may own it at a time.

To enable explicit local signing, stop the existing Console and restart with the
matching owner and policy administrator keyfiles. These are placeholder paths;
replace them with your existing local keys:

```sh
node packages/policy-cli/cyperlink.mjs console \
  --instance .local/my-instance/instance.json \
  --directory .local/my-console \
  --administrator .local/keys/POLICY_ADMINISTRATOR.json \
  --owner-a .local/keys/SOURCE_A_OWNER.json \
  --owner-b .local/keys/SOURCE_B_OWNER.json \
  --port 4321
```

One owner is sufficient for that source; omit an unavailable owner flag. Wallet A
selects the instance's first provisioned source and Wallet B the second. Either can
purchase either supported consumer effect. Console never adopts the deployment payer
as approval, and configured paths must match the selected owner/admin roles.

All flags take a value. `--instance` and `--directory` are required; the default port
is `4321`, with supported explicit ports `1024`–`65535`. Direct invocation through
`node apps/console/server.mjs` accepts the same flags. Ctrl-C drains active local work
before closing; it does not delete any records or stop the underlying runtime.

## Use the payment inbox

1. Choose **New payment** and enter a label, a positive integer amount below `2^48`
   in base units, a source, and an application effect. A merchant purchase needs a
   decimal u64 one-time SKU. A license needs a 64-character hexadecimal product ID
   and an immutable absolute expiry slot, with at most 1,000 slots of validity at
   settlement. The suggested observed slot plus 900 is only a convenience; review
   the actual expiry and allow time for the approvals and computation.
2. Review the exact intent and choose **Approve & prepare**. This signs native
   proof/action setup. It does not submit the private query or pay the merchant.
3. Open the intent and explicitly **Approve private query**. The configured owner
   and administrator authorize one query. An allow result is not payment or a
   capacity reservation.
4. If authorization remains current, separately **Approve payment**. Native payment,
   private-state consumption and the exact merchant/license effect settle together.
   An unavailable action stays disabled; polling never approves or recomputes it.

Overview summarizes the retained workspace; Payment inbox filters intents; Policy &
runtime identifies the connected release and configured sources. Recovery keeps the
original intent, signed deliveries and their independent observations visible.

## Read the result and recover

Payment/effect, receipt delivery, and entitlement use at the observed slot are separate
facts. Only an observed committed account effect establishes payment. A previously
confirmed payment stays recorded if current observation becomes unavailable; a license
activity claim requires its own observation. A paid expired license remains paid.

Restart with the same instance and workspace, omitting all signing flags, to observe
and recover without signer keys. Recovery may update local metadata, but never signs
or broadcasts. A separately selected **Submit retained query/payment** can submit only
the original signed bytes when the SDK permits it; that remains an onchain action even
in a keyless session. It cannot replace the transaction or renew an expiry. Uncertain
delivery is not permission to broadcast or create another charge.

After a terminal unpaid result, a user may separately prepare a fresh intent for the
same source and business purchase. Console preserves the old record as **Superseded**,
with a historical observation and a successor link. It no longer observes or submits
that old intent, and never attributes the successor's paid effect to it. Paid or
unresolved purchases block a duplicate intent in the same workspace. Keep the retained
workspace; creating another workspace is not a safe retry strategy.

If preparation or signing was interrupted, inspect/recover its retained records.
Console does not automatically repeat preparation or replace an interrupted approval.
It also does not automatically retry browser mutations after a timeout. Observe the
inbox before deciding what to do next.

A hard crash may leave `.server.lock`. Confirm the previous server and its authorized
child work have stopped before explicitly removing only that workspace's lock file.
Preserve `console.json`, plans and journals. Locks are never cleared automatically by
PID age/existence; removing one is not permission to restart signing or preparation.

## Scope

This is a trusted local developer tool with synthetic assets and explicit keyfile
signing, not a browser-wallet integration or a multi-user service. Account-wide
decryption keys remain in the local proof client; signer files and paths are not sent
to the browser. The local browser still sees the amount and intent you enter. Policy
source/constants are public; confidential policy thresholds belong in encrypted state.

The workspace supports at most 500 retained intents, with no compaction or cross-workspace
purchase deduplication. Local host/origin checks and session cookies are not production
identity or authorization infrastructure. Do not expose the server publicly. Policy
onboarding, build/deploy UI, broader wallet integration and production deployment remain
future work. See [current status](../../docs/STATUS.md) and the
[evidence index](../../docs/evidence.md) for completed qualification and remaining limits.

## Qualification

Host checks:

```sh
node --test apps/console/adapter.test.mjs apps/console/test/*.test.mjs
```

`qualify.mjs` is a synthetic reference-policy browser runner, not a customer policy
test generator. It needs the license reference's encrypted `remaining`/`purchase_cap`
state, cap40, at least50 native units on source A, and enough shared allowance for
two purchases. Run against an empty workspace with explicitly configured local signers.
Choose unused SKU/product identities and a new output directory; do not reset evidence.
Playwright and Chrome paths are explicit qualification tools, not product dependencies.

```sh
node apps/console/qualify.mjs \
  --playwright /path/to/playwright/index.mjs --browser /path/to/chrome \
  --instance .local/my-instance/instance.json --workspace .local/my-console \
  --output .local/new-browser-run --remaining 100 --amount 10 --sku 601 \
  --product dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd

node apps/console/verify.mjs \
  --results .local/new-browser-run/journey.json \
  --instance .local/my-instance/instance.json --output .local/new-browser-run/review.json
```

Stop Console gracefully after payment, then promptly qualify keyless recovery while
the validator still retains the receipt:

```sh
node apps/console/qualify-recovery.mjs \
  .local/my-instance/instance.json .local/my-console .local/new-recovery-run
```

This starts a separate keyless Console process and introduces selective test-only
HTTP503 responses. It requires an existing paid license with its retained approval
journal, confirms original receipt restoration, and checks that account bytes and
signed/attempt/simulation files stay unchanged. It does not renew expired transactions
or synthesize pruned receipts. Raw evidence remains under ignored `.local/`.
