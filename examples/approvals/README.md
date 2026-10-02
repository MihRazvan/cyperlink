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

## Interactive local client

After bootstrap, run from the repository root:

```sh
node examples/approvals/server.mjs \
  --bootstrap .local/approvals-01/approvals-bootstrap.json \
  --session .local/approvals-ui-01 --port 4317
```

Open `http://127.0.0.1:4317`. The client checks the ledger and all ten actual loaded
ELFs before accepting approvals. It binds only to loopback and serves a fixed
set of assets. Its private session directory contains plans, signed tickets,
receipts and recovery results; it is never a static web root. The local client
uses disposable signing files explicitly selected by the bootstrap. This is not
a remote signing service or a general wallet integration.

Choose a merchant SKU or software license and an exact synthetic amount. Prepare
creates genuine native proofs and the immutable action. **Approve private query**
requests the owner and administrator signatures for that exact policy check.
An authorized result is not payment. **Approve exact payment** obtains the final
owner signature and atomically transfers native tokens, consumes the current
quota version and issues the exact entitlement. The UI reports paid only when
the SDK observes the matching committed effect. License issuance and whether it
is still active are distinct; its displayed expiry is immutable.

For compatible purchases, pay A40, then prepare and approve B40 against the new
state. For competing requests, authorize A60, then authorize B60 before paying
A. Paying A makes B stale. A fresh B60 request needs fresh explicit query approval
and is denied against the remaining allowance. Preparing B before A's query
increments the quota query counter makes that unsigned B draft stale too; this
is intentional snapshot binding, not a reservation.

The final-approval dialog offers a clearly labeled test fault: send the actual
payment but hide its RPC acknowledgement. Stop and restart the server with the
same arguments, reopen the page, and select **Recover saved operation**. A
separate keyless worker reconciles the retained signature. If rebroadcast is
available, a separate action resends identical bytes. Recovery never changes a
blockhash, signs a replacement payment or silently asks the private policy again.
Do not delete interrupted runs. Partial native preparation without a completed
retained plan still requires inspection; arbitrary provisioning resume is not
implemented.

Owner view shows the approving client's amount and a labeled test-observer
remainder inferred from synthetic setup. Public observer omits amounts and
approval controls, but exposes identities, timing and policy decisions. Switching
views is an information projection, **not** an authentication boundary.

Host checks use explicit fake adapters and do not claim validator/MPC execution:

```sh
node --test examples/approvals/*.test.mjs
```

No dependency version or qualified on-chain program is changed by this interface.
