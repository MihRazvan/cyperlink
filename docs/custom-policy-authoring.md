# Write a private policy

A customer package contains original typed Rust expressions, an ordered private-state
schema and synthetic tests. CyperLink compiles the rule into the Arcium computation
that authenticates the native payment amount. New rules do not require core edits.

Use the [supported profile](architecture.md), [pinned local setup](local-bootstrap.md)
and [language contract](compiler-gate.md). Source/constants are public; confidential
thresholds belong in encrypted state. Host tests do not establish runtime execution.
Actual local qualification and remaining limits are indexed in [evidence](evidence.md).

## Author, test and build

From the repository root, choose a new application directory:

```sh
node packages/policy-cli/cyperlink.mjs policy init .local/my-app
# Edit policy.rs, policy.json and tests.json in your application.
node packages/policy-cli/cyperlink.mjs policy test .local/my-app
node packages/policy-cli/cyperlink.mjs policy build .local/my-app
```

Application packages may live outside CyperLink; generated runtime files and secrets
must remain under this repository's ignored `.local/`. `policy init` creates the
source, manifest, test vectors and generated-output ignore rule. Never put private
initialization values in the public package.

Declare one to four private u64 fields in identical order in `FIELDS` and the manifest.
Supported expressions include comparison, Boolean operations, private selection and
checked add/subtract/multiply. Fixed public helpers/loops can build expressions.
Arithmetic failure anywhere in the graph—including an unselected branch—denies and
preserves predecessor state. No division, dynamic private loops, private Rust `if`,
external facts, extra private input classes or arbitrary public outputs are supported.
See [compiler-gate.md](compiler-gate.md) for the exact interface and example syntax.

Tests are `{name, amount, state: [...], allow, next: [...]}` records. State order matches
the schema; use decimal strings for large integers. Optional `native_amount` and
`corrupt_commitment_byte` exercise native amount binding failures. Test execution uses
the actual compiler IR with synthetic values/commitments, not a validator or MPC run.
The existing count and reserve examples are internal reference policies, not customer
adoption. Authoring a new policy means new logic, not just changing their constants.

Build emits initializer/evaluator circuits, canonical release manifest and generated
`.cyperlink/bindings.mjs` with adjacent declarations. Release identity includes source,
ordered schema, compiler/platform provenance and circuit artifacts/interfaces, excluding
absolute machine paths. Even a source comment changes identity. Altered artifacts or
provenance require rebuilding; hashes do not freeze mutable deployment authorities.
Build runs the exact staged source against a retained snapshot of `tests.json` before
compilation. A separate qualification hash binds the release, source, vectors and test
log; new deployments require it. These are local integrity records, not independent
attestations. Existing deployments retain their original release identity.

Publication switches `current.json` last, after complete release artifacts and generated
bindings. If binding publication is interrupted, restore the validated current release:

```sh
node packages/policy-cli/cyperlink.mjs policy repair .local/my-app
```

Repair performs no compilation or transaction. If the first build never published a
current release, rerun build and preserve the interrupted work. This does not implement
arbitrary deployment/provisioning recovery or power-loss guarantees.
Local Cargo compilation is trusted developer code execution, not a hostile-code sandbox.

## Deploy locally

Prepare the pinned runtime as in [bootstrap](local-bootstrap.md). New custom deployments
require its explicit `--allow-pinned-sbf-v0-deployment` fresh-genesis option. The CLI
checks host Rust/Cargo 1.95.0; SBF compilation retains tools1.57/v0 and Auth's Rust1.89.
Do not substitute latest dependencies or overwrite an existing ledger/output.

Create an owner-only initializer under `.local/`, mode0600. Its object must contain
exactly your field names and canonical decimal-string u64 values. Any disclosed test
values are **synthetic test-observer disclosures**, not public application balances.
Then deploy, using your actual prepared environment and a fresh instance directory:

```sh
node packages/policy-cli/cyperlink.mjs policy deploy .local/my-app \
  --local --environment .local/localnet-my-run/preparation.json \
  --initial-state .local/my-initial-state.json --out .local/my-instance
```

Deployment builds isolated generated programs, compares actual loaded ELFs, uploads
and verifies circuit bytes/interfaces, obtains a real initializer callback, then
provisions synthetic native assets and hook routing. Success writes `instance.json`
and evidence. Failed/partial output is not a ready instance. Preserve it; arbitrary
deployment/provisioning crash recovery, in-place upgrades and state migration are
unsupported. Another policy needs a fresh deployment/output/key domain and mint.

## Open the local Console

After deployment completes and while the local validator/Arcium runtime is running,
connect the generated instance to a separate retained workspace:

```sh
node packages/policy-cli/cyperlink.mjs console \
  --instance .local/my-instance/instance.json \
  --directory .local/my-console
```

Open `http://127.0.0.1:4321`. This starts without signing keys. Follow the
[Console guide](../apps/console/README.md) to configure the matching source-owner and
administrator keyfiles explicitly. Native preparation, the private query and payment
each require their own review/approval; Console does not infer approval from a payer
key or automatically recompute a denied/stale intent.

Console provides the project overview, payment inbox, policy/runtime identity and
recovery interface over the generated session API below. Account decryption keys stay
in the local proof client. It requires an existing completed custom-policy deployment;
browser-wallet integration and author/test/build/deploy UI are not implemented. Preserve
the same Console directory across restart and keyless recovery, outside the deployment
archive. A new workspace is not a retry mechanism for an unresolved purchase.

## Integrate the generated session API

Import **your** generated bindings. Paths below are relative to the application file;
use absolute resolved paths where appropriate. Opening a session requires no keys:

```js
import { connectSession } from './.cyperlink/bindings.mjs';
const session = await connectSession({
  deployment: instance.descriptor,
  moduleRoot: instance.moduleRoot,
  endpoint: instance.endpoint,
  directory: approvalDirectory, // stable private .local directory across restarts
  idl: instance.idl,
  proofCli: instance.proofCli,
});
const signers = { ownerKeyfile, administratorKeyfile }; // explicit consent inputs
```

Do not adopt `instance.payerKeyfile` as automatic approval. The owner must match the
selected provisioned source; the administrator must match policy admission. Account-wide
decryption keys remain in the local proof client. No production wallet adapter is implied.

The following are separate application/user actions, not an automatic approval loop:

| Action | Public call |
| --- | --- |
| Prepare exact intent with owner/admin consent | `session.prepare({label, directory, provisionedDirectory, amount, consumer}, signers)` |
| Explicitly approve private query | `session.stageQuery(plan, signers)` then `session.submit(plan, 'query')` |
| Observe actual authenticated callback/state | `session.observe(plan)` with bounded read-only polling |
| Separately approve payment after current authorization | `session.stageCommit(plan, signers)` then `session.submit(plan, 'commit')` |
| Reopen in a new process | `session.load(operationDirectory)` |
| Keyless recovery, no simulation/broadcast | `session.recover(plan, 'query' or 'commit')` |
| Discover original ticket after interrupted publication | `session.discoverApproval(plan, role)` |

`prepare` creates a new operation in a fresh directory and performs signed native
proof/action preparation; it does not submit the private query. Amount is an integer
below2^48. Merchant consumer is `{kind: 'merchant', sku: 'DECIMAL_U64'}`. License consumer
is `{kind: 'license', productHex32, expirySlot: 'DECIMAL_SLOT'}`; product is32 bytes of
hex and the immutable absolute expiry permits at most1000 slots of validity at commit.
Use the actual `instance.assetDirectories` paths and their matching source owners.
Either provisioned source can buy either supported consumer effect.

Retain both operation and stable approval directories. The SDK owns the create-only
signing intent, signed wire and ticket; applications do not hand-edit journals or save
replacement signatures. After restart, connect with the same deployment/endpoint/
approval directory and load/recover with no signers. Recovery may persist local metadata
but makes no onchain writes. `APPROVAL_INTERRUPTED_BEFORE_SIGNED_RECORD` and ambiguous
candidates fail closed; repeating approval is not consent to sign again.

Explicit `submit` can complete an interrupted simulation or retransmit the same bytes
within its bounds. It never refreshes the blockhash/nonce, replaces private inputs or
renews expiry. Stale/denied requests need a separately authorized fresh operation,
Job/permit and nonce. Inspect the existing business effect first; do not charge again
because a receipt is unavailable. An unpaid stale purchase can retain its unissued
buyer/SKU; an issued SKU cannot represent a different purchase.

## Interpret results

`recover`/`submit` return `ticket`, `delivery` and `observation` separately.
Only `observation.status === 'committed'` establishes the bound paid effect.
`authorized` is not payment or a reservation. Denied/stale/expired outcomes never
silently authorize recomputation. `licenseActive` separately describes present use;
a paid expired license stays paid but gives no renewed access.

`delivery` retains signature/hash, status, broadcastability, optional receipt and
sanitized availability metadata. Receipt-null, transport outage and failed receipt
are distinct. Recognized receipt/status outage can still reconcile committed accounts;
combined account outage remains unresolved. Uncertain delivery is nonbroadcastable,
including explicit submit. Malformed evidence, wrong ledger, signature/ALT mismatch,
regressing snapshots or partial paid effects remain hard failures. Genesis/ALT access
still needs RPC; this is not general offline recovery.

Use [Console](../apps/console/README.md) for the local browser workflow. Superseded
terminal unpaid intents remain historical records linked to their separately prepared
successors; the old intent is never credited with the successor's payment or entitlement.
The [explicit session example](../examples/license-session/README.md) demonstrates
application integration. Use [evidence](evidence.md) for qualification commands and
archived reference workflows, including the deferred frozen outside-builder exercise.

## Use the project service API

The local project service provides a stable HTTP boundary for completed deployments
and retained operations. The generated policy session remains the client for native
preparation and explicit query/payment approvals. The service opens those operations
without account keys and never signs, simulates or submits their transactions.

Create a mode0600 JSON configuration under `.local/`, with absolute resolved paths:

```json
{
  "schema": 1,
  "directory": "/absolute/cyperlink/.local/project-service",
  "port": 4331,
  "token": "REPLACE_WITH_A_RANDOM_URL_SAFE_TOKEN_AT_LEAST_32_CHARACTERS",
  "sources": {
    "my-app": {
      "instancePath": "/absolute/cyperlink/.local/my-instance/instance.json",
      "workspaceDirectory": "/absolute/cyperlink/.local/my-console"
    }
  }
}
```

The token is a separate API credential, never an account or wallet key. Generate it
locally and keep the configuration private. Start with:

```sh
node packages/policy-cli/cyperlink.mjs service --config .local/service-config.json
```

`@cyperlink/service-client` has no external dependencies and includes TypeScript
declarations. It is an unpublished local package; use its source entrypoint today:

```js
import { CyperLinkServiceClient } from './packages/service-client/src/index.mjs';
const api = new CyperLinkServiceClient({ endpoint: 'http://127.0.0.1:4331', token });
await api.registerProject({ id: 'licenses', source: 'my-app' });
await api.importOperation('licenses', { id: 'purchase-123', reference: operationId });
const current = await api.observe('licenses', 'purchase-123');
const recovery = await api.recover('licenses', 'purchase-123', 'commit');
```

Default operation references name existing Console workspace `operations/<reference>`
directories and use that workspace's original `approvals` journal. For a standalone
SDK application, add `operationSources` to the configured source:

```json
{
  "purchase-123": {
    "directory": "/absolute/cyperlink/.local/original-operation",
    "approvalsDirectory": "/absolute/cyperlink/.local/original-session"
  }
}
```

The object above is the value of `operationSources`. Each reference resolves an
already prepared plan and its original session directory. HTTP clients supply aliases,
not filesystem paths. Additional aliases can be configured between service restarts;
remapping an imported operation's plan or journal is rejected. Registration verifies
the release, bindings, circuit artifacts, ten loaded program ELFs and ledger identity.

| Method and route | Behavior |
| --- | --- |
| `POST /v1/projects` | Register `{id, source}`; same identity is idempotent |
| `GET /v1/projects` or `/<project>` | Retained project metadata |
| `POST /v1/projects/<project>/operations` | Import `{id, reference}` |
| `GET /v1/projects/<project>/operations` or `/<operation>` | Retained operation metadata |
| `POST .../<operation>/observe` with `{}` | Fresh SDK observation |
| `POST .../<operation>/recover` with `{role: "query"}` or `{role: "commit"}` | Recover the original signed transaction without submitting |

Requests use `Authorization: Bearer <token>` and JSON bodies. Responses use
`{apiVersion: "v1", data}` or `{apiVersion: "v1", error: {code, message, requestId}}`.
Errors include HTTP status and a request correlation ID in the client. Interrupted
requests are unresolved; there is no automatic HTTP retry. Reconcile the same resource
ID before repeating a registration/import. A new operation ID is not a payment retry.

GET returns stored metadata without RPC. POST observation/recovery records fresh
findings and a monotonic observation floor. `paymentCommitted` preserves the historical
paid fact during an outage; it does not imply current license validity. Fresh failures
set `lastError`; retained payment history never grants a new entitlement.

This is a loopback service with explicit local configuration, a single writer, bounded
JSON registry (100 projects, 5000 operations, 8 MiB) and synchronous RPC calls. It is not
a hosted multitenant service or job queue. A hard process crash can leave the existing
private-store lock; verify the process is stopped before manual lock reconciliation.
Graceful service restart is supported. SDK signing/storage portability, arbitrary setup
recovery, remote proof/signing providers and managed deployment remain unfinished.
The HTTP client is portable; the underlying policy runtime still requires this local
profile and repository storage layout.
