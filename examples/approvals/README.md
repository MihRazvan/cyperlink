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

## Verify an interactive session

Once explicit user actions have completed and the application is idle, keep its
validator running and run the keyless reviewer:

```sh
node examples/approvals/verify-session.mjs \
  --bootstrap .local/approvals-01/approvals-bootstrap.json \
  --session .local/approvals-session-01 \
  --out .local/approvals-session-01/independent-review.json
```

The reviewer uses only loopback account and transaction reads. It never loads a
signer, prepares proofs, submits a transaction, or resumes an operation. It checks
all ten loaded program binaries, retained operation intent, owner/administrator
signatures, exact landed messages, immutable action bytes, and fresh SDK
observations of the Job, permit, quota and application effect. A committed effect
also requires the exact successful query and settlement receipts. Available
keyless recovery artifacts are matched to retained plans and signed tickets.

The create-only report excludes requested amounts, secret material, raw signed
wires and private session events. `passed` means the review checks passed; each
operation's fresh `observation.status` identifies whether payment committed.
Query/settlement validator fees and CU are recomputed from live receipts;
bootstrap totals are separately labelled archived reports. Later proof setup
and callback costs are excluded from those receipt totals, and worker resource
costs remain unmeasured. This review trusts confirmed local RPC evidence and
reuses upstream verification and SDK interpretation; it is not an independent
cryptographic audit or a historical state proof. Reuse of an output filename or
retained intent or signed tickets changing during review fails closed. Cached
UI observations may refresh; the verifier obtains its own chain observations.

Capture the corresponding distributed-runtime callback receipts separately,
while the same validator is still running:

```sh
node examples/approvals/verify-session-callbacks.mjs \
  --bootstrap .local/approvals-01/approvals-bootstrap.json \
  --session .local/approvals-session-01 \
  --out .local/approvals-session-01/callback-review.json
```

This requires one successful callback per retained queued operation. It verifies
actual transaction Ed25519 signatures, the auth callback discriminator and exact
Job/computation/permit association, the disclosed native amount commitment, and
the policy decision against live Job/permit state. Authorized successors must
match the callback ciphertext; denials must leave an empty permit. The report
contains public receipt hashes and callback-only validator costs. Full signed
RPC receipts and public account snapshots are retained locally in the adjacent
`.receipts.json` file, both create-only. Runtime BLS authenticity relies on the
successful on-chain callback check; this tool does not claim an independent BLS
verification or measure distributed worker resource costs.
