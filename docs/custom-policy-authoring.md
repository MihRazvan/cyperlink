# Customer-authored private policies

A customer package contains original Rust expressions, a private-state schema
and synthetic tests. CyperLink compiles the expressions into the same Arcium
computation that authenticates the native payment amount. New rules do not
require a CyperLink core branch or a new payment adapter.

**Runtime qualification is in progress.** The commands below describe implemented
tooling, not a completed two-policy settlement claim. See the
[acceptance matrix](custom-policy-implementation.md#acceptance-matrix-pending-real-execution)
and [current status](STATUS.md). The completed legacy Approvals and separate
Permissions escrow evidence remain intact. The forthcoming
[custom-policy qualification report](custom-policy-qualification.md) will record
actual runtime results; that qualification is currently pending.

## Write, test and build a package

Use the pinned prerequisites from [fresh bootstrap](local-bootstrap.md). Run these
commands from the repository root; no global CLI installation is required:

```sh
node packages/policy-cli/cyperlink.mjs policy init .local/my-count-app
```

The new directory contains `policy.rs`, `policy.json`, `tests.json` and a
`.gitignore` for generated `.cyperlink/` output. Write your rule in `policy.rs`
and declare the same ordered fields in its `FIELDS` constant and manifest.
The public package must not contain private initialization values. Package
directories may live outside CyperLink; runtime files and secrets stay under this
repository's ignored `.local/`.

For a working two-field starting example, copy only its source/schema/tests:

```sh
cp examples/policies/budget-count/policy.rs .local/my-count-app/policy.rs
cp examples/policies/budget-count/policy.json .local/my-count-app/policy.json
cp examples/policies/budget-count/tests.json .local/my-count-app/tests.json
node packages/policy-cli/cyperlink.mjs policy test .local/my-count-app
node packages/policy-cli/cyperlink.mjs policy build .local/my-count-app
```

The [count policy](../examples/policies/budget-count/policy.rs) decreases private
remaining capacity and increases private purchase count. The public limit of5
is source code, not a confidential threshold. The
[minimum-reserve policy](../examples/policies/minimum-reserve/policy.rs) instead
preserves a privately initialized reserve and requires the successor allocation
to remain above it. It was authored by a separate agent against the documented
API, without a core policy-name special case; both examples are internal work,
not external adoption. [Budget-only](../examples/policies/budget-only/policy.rs)
is the compatibility control.

```sh
node packages/policy-cli/cyperlink.mjs policy test examples/policies/minimum-reserve
node packages/policy-cli/cyperlink.mjs policy build examples/policies/minimum-reserve
node packages/policy-cli/cyperlink.mjs policy test examples/policies/budget-only
```

Tests execute the actual compiler IR with synthetic inputs and SDK7 Pedersen
commitments. They do not send transactions or run distributed MPC. Test records
use `{name, amount, state: [...], allow, next: [...]}`; state order matches the
schema. Use decimal strings for large integers. Optional `native_amount` and
`corrupt_commitment_byte` exercise amount-binding failures. Real payment rules
run in MPC, not this plaintext host evaluator.

Build emits both initializer/evaluator circuit artifacts, a canonical release
manifest and `bindings.mjs` with adjacent `bindings.d.mts`. Identity includes
customer source, ordered schema, compiler/platform provenance and all circuit
artifacts/interfaces; it excludes absolute machine paths. Identical builds reuse
the same release. Changed source, even a comment, changes release identity;
changed logic can also change circuit bytes. Reordered state fields are a different
schema. Altered source, manifest, artifacts or platform provenance fail deployment
validation and require a new build. These hashes do not replace deployment
authority or freeze mutable programs.

## Supported authoring language

The [authoring contract](compiler-gate.md) defines `Context`, `Payment`, `State`,
`U64`, `Bool` and `Decision`. A function receives the authenticated payment amount
and1–4 named private u64 fields; four encrypted slots are always present and unused
slots must be zero. Supported operations are comparisons, Boolean and/or/not,
private selection and checked addition/subtraction/multiplication. Fixed public
helpers and loops may construct expressions. The entire expression graph fails
closed on arithmetic errors, including a branch that is not selected. A denial
preserves all predecessor state fields. Division, dynamic private loops, private
Rust `if`, arbitrary outputs and additional private inputs are unsupported.

The fallback uses pinned Arcis0.15 ScalarField253 expressions with CSplRescueCipher.
High-level Arcis uses BaseField255/RescueCipher, and the executed cipher probe
shows that these transports are incompatible. We did not connect them through
an unchecked amount or plaintext handoff. The mandatory wrapper verifies all32
bytes of the native commitment with the full opening scalar and limits the amount
to less than2^48. Customer fields are bounded u64. Native proof verification remains
SDK7; the verifier is not downgraded to Arcis's upstream SDK4 dependency.

Source and constants are public. Place confidential thresholds in encrypted state,
not Rust literals. Compilation checks the supported interface; it does not certify
rule correctness or privacy. A Boolean result can leak information over repeated
queries. Local Cargo compilation is trusted developer code execution, not a sandbox
for hostile packages or a hosted build service.

## Prepare a local environment and deploy

Build the legacy pinned toolchain/program/proof CLI prerequisites as described in
[fresh bootstrap](local-bootstrap.md). Choose a fresh run ID and unused ports.
Only one validator should run on this host because faucet9900 is shared; the
upstream generator also probes default8899. Stop only your identified previous
runtime using that guide; preserve all ledgers and failed outputs.

```sh
python3 scripts/prepare_localnet.py --run-id policies-01 \
  --rpc-port 8975 --metrics-port 9371 \
  --allow-pinned-sbf-v0-deployment
```

The opt-in disables only Agave4.3.0 feature
`B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g` at **fresh local genesis**.
SIMD-0500 otherwise rejects new deployments produced by the pinned tools1.57
`arch v0` target, although the legacy genesis-loaded programs execute. The
preparation report records this explicit feature deviation. Default bootstrap is
unchanged. This is not default Agave feature parity or public-network deployability;
no dependency version or compiler architecture was silently changed.

From `.local/localnet-policies-01/app`, run these in separate terminals:

```sh
python3 run-validator.py
```

```sh
docker compose -f artifacts/compose.json up -d --pull never
```

Back at the repository root, create an owner-only initializer file. These example
values are **synthetic test-observer disclosures**, not live state decryption:

```sh
python3 - <<'PY'
import json, os
path = '.local/count-initial-01.json'
fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, 'w') as out:
    json.dump({'remaining': '100', 'purchases': '4'}, out)
PY
node packages/policy-cli/cyperlink.mjs policy deploy .local/my-count-app \
  --local \
  --environment .local/localnet-policies-01/preparation.json \
  --initial-state .local/count-initial-01.json \
  --out .local/count-instance-01
```

The initialization object must contain exactly the schema's field names and
canonical decimal-string u64 values. A reserve instance instead uses, for example,
`{"remaining":"100","reserve":"50"}` in its own private file. Deploy its package
with the same `--environment` and a new output directory to create a second
coexisting instance. Each gets generated Auth/policy/guard/consumer programs,
its own MXE encryption key and a separate synthetic no-fee mint. Two MXEs on this
cluster are not independent operators. Same-mint multi-policy routing is unsupported.

For the disclosed count setup, a40 purchase should advance count4→5 and leave60
capacity; a further small fresh purchase should be denied by the count rule.
The reserve example `[100,50]` should reject60 although budget-only would accept
it. These are expected test-observer outcomes to qualify, not claims that the
commands above have already produced successful runtime evidence.

Deployment builds exact programs, compares actual loaded ELFs, uploads and checks
actual circuit bytes/interfaces, obtains a real initializer callback, then provisions
native assets and hook routing. Success writes private `instance.json` and retained
evidence under `--out`. In-progress/failed phases are not ready instances. Keep failed
directories and inspect their logs; arbitrary partial deployment recovery, reset,
in-place rule upgrade and state migration are unsupported. Use a fresh output/release
or instance as appropriate, never overwrite an existing ledger to hide a failure.
Each generated native build uses an isolated per-instance Cargo target directory
so changing deployment constants cannot accidentally reuse another instance's ELF.
No compilation or deployment throughput claim follows from this choice.

## Generated SDK lifecycle and recovery

Generated bindings select the release and expose the typed private initializer
shape. The deployment descriptor supplies generated program/state/MXE identities.
The [client API](../packages/policy-client/README.md) separates preparation,
query approval, observation and final payment approval. For a local application,
the following are separate user-action handlers, not an automatic spending loop:

```js
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { connect } from './.local/my-count-app/.cyperlink/bindings.mjs';
import { createPrivateRun, loadWeb3, loadSigner, writeNew }
  from './packages/local-client/src/runtime.mjs';

const instance = JSON.parse(await readFile('.local/count-instance-01/instance.json'));
const directory = await createPrivateRun('.local/count-client-01');
const client = await connect({ deployment: instance.descriptor,
  moduleRoot: instance.moduleRoot, endpoint: instance.endpoint,
  payerKeyfile: instance.payerKeyfile, directory, idl: instance.idl,
  proofCli: instance.proofCli });
const web3 = await loadWeb3(instance.moduleRoot);
const owner = await loadSigner(resolve(instance.assetDirectories.merchant,
  'source-owner-signer.json'), web3);

async function preparePurchase() {
  return client.prepare({ label: 'purchase-01', directory: '.local/count-operation-01',
    provisionedDirectory: instance.assetDirectories.merchant, amount: 40,
    consumer: { kind: 'merchant', sku: '7' } });
}
async function approvePrivateQuery(plan) {
  const ticket = await client.stageQuery(plan, { owner });
  await writeNew(resolve(directory, 'query-ticket.json'), JSON.stringify(ticket));
  return client.submit(plan, ticket);
}
async function approveExactPayment(plan) {
  if ((await client.observe(plan)).status !== 'authorized')
    throw Error('A current authorization is required');
  const ticket = await client.stageCommit(plan, { owner });
  await writeNew(resolve(directory, 'commit-ticket.json'), JSON.stringify(ticket));
  return client.submit(plan, ticket);
}
// Read-only polling: await client.observe(plan).
// Only observation.status === 'committed' establishes the actual paid effect.
```

Retain the complete operation directory, private signed journal and tickets.
After restart, use `client.load(operationDirectory)` to reopen the same plan.
Do not call preparation/staging again merely because a send response was lost.
A separate keyless process can reconcile the retained exact payment:

```sh
node packages/policy-client/recover-operation.mjs \
  --plan .local/count-operation-01/operation-plan.json \
  --rpc http://127.0.0.1:8975 --module-root .local/toolchain/js \
  --action recover-ticket --role commit \
  --ticket .local/count-client-01/commit-ticket.json \
  --out .local/count-client-01/recovery-01.json
```

`recover-ticket` only observes/reconciles. Explicit `submit-ticket` can rebroadcast
the retained bytes when permitted; it does not replace blockhashes, create another
signature, decrypt state or silently issue a fresh private query. Expired unresolved
delivery requires inspection, not an assumption of failure. Arbitrary interruption
during native provisioning before a complete retained plan is a separate open limit.

The existing Approvals UI accepts the new instance directly:

```sh
node examples/approvals/server.mjs \
  --bootstrap .local/count-instance-01/instance.json \
  --session .local/count-approvals-01 --port 4317
```

It shows the selected policy/release and actual SDK decision, with separate query
and final approvals. Use the labeled lost-acknowledgement fault and restart/recovery
controls to exercise delivery handling. Its owner/public projections are not an
authentication boundary. Private initializer fields are not rendered as balances.

## Authority and qualification boundaries

`local-custom-policy-v1` uses a353-byte state and712-byte permit, preserving the
hook's active-permit pointer at offset129. The complete encrypted predecessor,
successor, nonce and release/schema/domain identity are bound. Callback approval
does not consume business state: settlement commits state, native payment and exact
merchant/license effect atomically. Admission counters are separate; even
counter-only drift invalidates a delayed signed query. Competing authorizations
cannot reserve or both consume one predecessor.

The deployment administrator initializes once, approves the release/state domain,
and co-signs each private query with the source owner. The owner separately signs
the exact final payment. Every fresh query is an authorized disclosure, including
one later abandoned; no automatic preview, threshold-search or recomputation API
is provided. Account-wide ElGamal/AES keys stay in the local client; only operation
amount/opening and initialization values use encrypted MPC transport. Client input
keys/nonces are ephemeral; MXE successor nonces share a monotonic admission domain
across initialization and queries.

Onchain generated programs enforce release/schema/domain identity and exact
native action, owner, state and consumer bindings. Deployment tooling checks source,
ELF and uploaded-circuit correspondence. The administrator and mutable program
upgrade authorities remain trusted; a descriptor or circuit digest is not an
independent security certificate. Distinct MXE keys isolate these instances from
ordinary cross-instance ciphertext substitution; a malicious shared operator or
upgrade authority is outside this local trust model.

The asset profile remains synthetic Token-2022 confidential transfer with configured
hook, no transfer-fee extension even at0bps, no CPI Guard, and ordinary owner
signatures. AUSD, delegates/autonomous Permissions, private payouts unknown to the
owner, external facts, cross-MXE private calls and production security are not
enabled by authoring support. Legacy v0 accounts and recovery archives retain their
original decoders and evidence. Compiler ACUs, compilation time, proof/provisioning,
queue, callback and settlement costs must be reported separately; host tests and
local RPC snapshots are not distributed execution or historical consensus proofs.
