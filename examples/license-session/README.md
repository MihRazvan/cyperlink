# Paid license with an explicit approval session

This is an additive integration of the unchanged `license-app` private policy and
license effect. The original application and v21b archive remain the reference.
The CLI reuses its argument validation and outcome projection; all operation
lifecycle and recovery calls here use generated `connectSession` bindings.

Build the reference policy to regenerate bindings. Deploy a **fresh** instance as
shown in `../license-app/README.md`, with the same qualified local profile. The
CLI accepts the reference commands and options:

```sh
node examples/license-session/app.mjs prepare \
  --instance .local/INSTANCE/instance.json --operation .local/OPERATION \
  --admin-keyfile .local/ADMIN.json --owner-keyfile .local/INSTANCE/asset-b/source-owner-signer.json \
  --amount 10 --product HEX_32_BYTES --expiry-slot FUTURE_SLOT --label license-one
node examples/license-session/app.mjs approve-query \
  --instance .local/INSTANCE/instance.json --operation .local/OPERATION \
  --admin-keyfile .local/ADMIN.json --owner-keyfile .local/INSTANCE/asset-b/source-owner-signer.json
node examples/license-session/app.mjs observe \
  --instance .local/INSTANCE/instance.json --operation .local/OPERATION
```

After `authorized`, use `approve-payment` with the same two explicit signer
options. `recover --role query|commit` accepts **no keys**. `--submit yes` expressly
permits resending the retained transaction; it does not approve a new transaction.
Both roles are necessary in this local profile: owner consent and administrator
query admission/transaction fee payment. Native decryption keys stay in the local
proof preparation client.

Each operation uses a stable sibling directory `OPERATION-approvals`. The SDK
persists a create-only intent before signing, signs at most once per role there,
then persists the ticket itself. A fresh session discovers its exact original
signed record when a ticket was never saved. Discovery verifies signatures,
descriptor, native/action/consumer instruction, lookup tables and ledger identity.
The application no longer manages ticket files or launches recovery workers.

A crash before signed-wire persistence leaves an explicit interrupted attempt;
repeating approval cannot silently replace it. Multiple signed candidates fail
closed. Recovery alone does not simulate or broadcast. If simulation was interrupted,
explicit submission simulates the **original** signatures and blockhash before
sending. Expired unresolved transactions remain unresolved; refresh needs a
separately authorized new operation. Provisioning interruptions are not covered.

Run actual process-crash qualification only against pristine business state:

```sh
node examples/license-session/qualify.mjs .local/INSTANCE/instance.json .local/NEW-QUALIFICATION
```

`crash.mjs` is a qualification-only preload that sends SIGKILL after durable
boundaries. It never injects proofs, permits, callback signatures or verified
contexts. The harness discloses synthetic allowance50/cap30 and purchases10/20 as
test-observer values. Host tests and real runtime results are reported separately
in the repository milestone document.
