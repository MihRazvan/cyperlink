# Local operation lifecycle

`LocalOperationClient` turns an existing locally provisioned confidential source
into an explicitly authorized private purchase. It supports the initial synthetic
no-fee mint, configured hook, one quota/MXE, and administrator co-signing. Run the
fresh localnet setup, initialize its quota through the real runtime, and verify
loaded program bytes before using it. Preparation does not bootstrap the runtime.

```js
import { LocalOperationClient, loadSigner } from './packages/local-client/src/index.mjs';
import { createPrivateRun, writeNew } from './packages/local-client/src/runtime.mjs';

const client = await LocalOperationClient.connect({
  moduleRoot: '.local/toolchain/js', endpoint: 'http://127.0.0.1:8899',
  payerKeyfile: '.local/my-localnet/app/local-test-wallet.json',
  directory: await createPrivateRun('.local/my-operation-session'),
  idl: 'programs/auth/target/idl/cyperlink_auth.json',
  proofCli: 'crates/client-proofs/target/debug/cyperlink-client-proofs',
});
const plan = await client.prepare({
  label: 'merchant-60', directory: '.local/merchant-60',
  provisionedDirectory: '.local/my-source', amount: 60,
  consumer: { kind: 'merchant', sku: '7' },
});
const owner = await loadSigner('.local/my-source/source-owner-signer.json', client.session.web3);
const queryTicket = await client.stageQuery(plan, { owner });
await writeNew('.local/merchant-60/query-ticket.json', JSON.stringify(queryTicket));
await client.submit(plan, queryTicket);
// Observe again after the authenticated callback; authorization is not a reservation.
const observation = await client.observe(plan);
if (observation.status === 'authorized') {
  const commitTicket = await client.stageCommit(plan, { owner });
  await writeNew('.local/merchant-60/commit-ticket.json', JSON.stringify(commitTicket));
  await client.submit(plan, commitTicket);
  const paid = await client.observe(plan); // Require status === 'committed'.
}
```

For the license consumer, use `{ kind: 'license', productHex32: <64 hex digits>,
expirySlot: <decimal u64 string> }`. SKU, expiry, and query identity integers use
canonical decimal strings; native amount uses an exact positive JavaScript integer
below 2^48. The example amount is a test-observer disclosure.

| Method | Effect |
| --- | --- |
| `prepare(...)` | Explicitly creates fresh native proofs, verifies them natively, initializes a blank permit/consumer record, prepares an immutable action, and retains an encrypted query plan. |
| `stageQuery(plan,{owner})` | Checks the current quota snapshot and runtime key, obtains owner/admin signatures, and journals the signed query before simulation. |
| `submit(plan,ticket)` | Checks actual signed instruction semantics and live ALT resolution, then sends only the retained signed bytes within the journal's broadcast budget. |
| `observe(plan)` | Reads Job, permit, quota, and consumer effect together; never creates or submits a private query. |
| `stageCommit(plan,{owner})` | Requires an authorized observation, signs the exact native payment and consumer effect, and journals it. |
| `recover(plan,ticket)` | Reconciles transaction delivery and operation state; never broadcasts or refreshes authorization. |
| `load(directory)` | Validates the retained plan and ledger identity without preparing new proofs. |

`operation-plan.json` retains the locally chosen descriptor, exact query and
commit instructions, encrypted inputs, native bytes, proof context snapshots, and
ledger genesis. Expectations are not adopted from a returned Job. Account-wide
ElGamal/AES keys stay in the Rust client's private files. The separate operation
witness is also private; it is never a recovery-worker input.

To resume in a new process without any signing key, use:

```sh
node examples/two-consumers/recover-operation.mjs \
  --plan .local/merchant-60/operation-plan.json \
  --rpc http://127.0.0.1:8899 --module-root .local/toolchain/js \
  --action recover-ticket --ticket .local/merchant-60/query-ticket.json \
  --role query --out .local/merchant-60/recovered-query.json
```

`--action observe` takes no ticket or role. `--action submit-ticket` explicitly
permits sending the existing ticket; `--role commit` selects a commit ticket.
Output is create-only and includes process identity, retained-artifact hashes,
public operation identity, delivery classification, and the SDK observation.
It omits signed wires, private witnesses, and keys.

A missing receipt is not proof of failure. An expired unresolved ticket stays
unresolved; no helper replaces its blockhash, regenerates proofs, or reserves a
new nonce. A changed quota snapshot rejects the old query before private
computation. Stale, denied, or expired application authorization requires an
explicit fresh `prepare` and new signatures if the user still wants the purchase.
A landed query transaction or authorized callback is not payment: only the
consumer-aware `committed` observation establishes the complete atomic effects.

Recovery applies to completed operation plans and their retained signed tickets.
It does not resume arbitrary partially completed native provisioning. Observations
must be at least as recent as the context slot saved in the plan or recovered
transaction receipt; additional monotonicity is maintained within a reader.
This is not a persistent history of every observation or a proof against RPC
dishonesty or chain reorganizations. The local validator and selected confirmed
commitment remain part of the evidence boundary.

Host tests exercise synthetic signed messages, altered semantic bindings, live
ALT-resolution checks with mocked RPC, journal restarts, and separate processes.
These tests are not native-validator or distributed-runtime evidence; live
qualification must be reported separately with loaded program hashes and receipts.
