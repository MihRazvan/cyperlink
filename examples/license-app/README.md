# License application: private purchase cap and allowance

An internal docs-first application using generated CyperLink bindings and the
license consumer. The original policy accepts positive native payments at or below
both private `purchase_cap` and private `remaining`. Settlement decreases remaining
and preserves the cap. Denial preserves both fields. Public source contains no
private initialization values. This is not independent customer validation.

The [qualified reference run](../../docs/evidence.md) passed real
Arcium decisions, two paid licenses, stale/rollback/replay failures and exact
cross-process recovery. It also records the SDK source assistance and application
fix required during integration. Runtime commands and evidence are in that guide.

From the repository root:

```sh
node packages/policy-cli/cyperlink.mjs policy test examples/license-app
node packages/policy-cli/cyperlink.mjs policy build examples/license-app
node --test examples/license-app/app.test.mjs
```

The directory was created with `policy init`. The generated `.cyperlink/` output
is ignored. Tests run the actual compiler IR with synthetic native commitments;
14 vectors cover cap denial despite available allowance, exact cap, exhaustion,
zero amount/cap, u64 state, native48 boundaries, amount mismatch and a changed
commitment. They are host evidence, not validator or distributed execution.

Deploy with the documented `policy deploy --local` command, an existing prepared
environment, and a private initializer containing exactly `remaining` and
`purchase_cap` decimal strings. Keep that file, the instance and all runtime data
beneath repository `.local/`. Deployment and runtime qualification are separate
from this application's host tests. See [API friction](https://github.com/MihRazvan/cyperlink/blob/builder-exercise-v1/examples/license-app/FRICTION.md).

Each CLI invocation is a separate process. Set paths to your fresh local instance,
its explicitly approved administrator and selected provisioned source owner:

```sh
INSTANCE=.local/license-instance/instance.json
ADMIN=.local/localnet-license/app/local-test-wallet.json
OWNER=.local/license-instance/asset-b/source-owner-signer.json
OPERATION=.local/license-purchase-one
```

Use the actual `instance.assetDirectories.license` path for `OWNER`. The app never
adopts `instance.payerKeyfile` as implicit signing authority. Every mutation command
requires the administrator and owner paths explicitly. Preparation also authorizes
the documented native provisioning/immutable-action transactions; it does not
submit a private query. An optional `--provisioned-directory` selects another
provisioned source (including the merchant source) while still buying a license.

Choose the exact 32-byte product identifier and absolute expiry slot. The consumer
allows at most1000 slots of validity at payment. Both are immutable action fields;
an expiry chosen too far ahead, or reached before payment, cannot be refreshed.
The following values are placeholders for a real product and current local slot:

```sh
node examples/license-app/app.mjs prepare \
  --instance "$INSTANCE" --operation "$OPERATION" \
  --admin-keyfile "$ADMIN" --owner-keyfile "$OWNER" \
  --label license-one --amount 30 \
  --product aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --expiry-slot 1000

node examples/license-app/app.mjs approve-query \
  --instance "$INSTANCE" --operation "$OPERATION" \
  --admin-keyfile "$ADMIN" --owner-keyfile "$OWNER"

node examples/license-app/app.mjs observe \
  --instance "$INSTANCE" --operation "$OPERATION"

node examples/license-app/app.mjs approve-payment \
  --instance "$INSTANCE" --operation "$OPERATION" \
  --admin-keyfile "$ADMIN" --owner-keyfile "$OWNER"
```

Only an `authorized` observation permits a fresh payment approval. Only `committed`
establishes payment and the exact license effect; `authorized` is not a reservation
and `licenseActive` separately reports present validity. Denial reports
`outcome: rejected`; stale, expired, invalidated and cancelled authorizations report
`action-required`. Pending states report `unresolved`. The exact SDK status and
delivery status remain separate; these outcomes do not establish payment failure.
No command automatically prepares another query or replaces an expired signature.

Query and payment approvals retain their tickets before sending. To stage and
save without broadcasting, pass `--submit no`. Repeating that approval command
loads the exact saved ticket instead of signing again. Sessions have fresh private
paths under `.local/license-app-invocations`; operation plans, intents and tickets
remain in the chosen operation directory. Keep all sessions because ticket journals
are referenced there. This supports reopening completed plans and tickets after
process restart; it does not recover arbitrary interrupted native provisioning.

After a lost response, reconcile without any signing key:

```sh
node examples/license-app/app.mjs recover \
  --instance "$INSTANCE" --operation "$OPERATION" --role commit
```

For explicitly authorized retransmission of the same signed bytes, add
`--submit yes`. Recovery uses the documented separate keyless worker. Its report
retains delivery and operation status independently; an expired unresolved
transaction does not become a presumed failure. Recovery never refreshes the
blockhash, nonce, private inputs or signature. If staging was interrupted before
the returned ticket was saved, the retained approval intent blocks restaging;
consult the historical friction report linked above. New integrations should use
[the session API](../license-session/README.md), which owns ticket discovery.
