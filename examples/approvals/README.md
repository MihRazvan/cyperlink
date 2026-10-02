# Local Approvals demo

## Bootstrap

Start a fresh isolated validator and two-node runtime using the
[fresh bootstrap guide](../../docs/local-bootstrap.md). Then initialize the
shared encrypted allowance and two independently owned native accounts:

```sh
node examples/two-consumers/run.mjs \
  --scenario bootstrap --out .local/approvals-01 \
  --preparation .local/localnet-approvals-01/preparation.json \
  --module-root .local/toolchain/js \
  --payer .local/localnet-approvals-01/app/local-test-wallet.json \
  --idl .local/localnet-approvals-01/app/target/idl/cyperlink_auth.json \
  --circuits .local/localnet-approvals-01/app/build \
  --proof-cli crates/client-proofs/target/debug/cyperlink-client-proofs \
  --rpc http://127.0.0.1:8899
```

Bootstrap verifies the loaded ELF bytes, initializes the allowance through the
real runtime callback, provisions both sources and destinations under one
synthetic no-fee mint, and initializes its hook metadata. It stops before
preparing or signing any purchase query. The initial allowance and native
funding of 100 are **test-observer disclosures**.

The private, create-only `.local/approvals-01/approvals-bootstrap.json` records
the ledger genesis, local paths, asset directories and loaded-program evidence
for the interactive application. It references local signing material without
embedding secret keys. Keep this manifest and its surrounding directory local.
`results.json` retains initialization receipts and separates native provisioning,
runtime uploads, queue and callback validator costs; distributed worker resource
costs remain unmeasured. `passed:true` with `bootstrap-only-not-purchase` means
setup completed, not that a purchase was authorized or paid.

Each bootstrap needs a new output directory and a fresh ledger without a quota.
An existing initialized ledger fails closed. Preserve interrupted runs for
inspection; this command does not resume partial provisioning or reset state.
