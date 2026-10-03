# Custom-policy local client

For new applications, start with the generated `connectSession` workflow in the
[current authoring guide](../../docs/custom-policy-authoring.md). The lower-level
`connect` API below remains available for existing integrations.


This is the explicit `local-custom-policy-v1` client. Legacy SDK decoding and
historical plans remain unchanged. Generated bindings supply a deployment
containing its release, schema, key domain and generated program identities.

```js
import { PolicyOperationClient } from './src/index.mjs';
const client = await PolicyOperationClient.connect({
  deployment, moduleRoot, endpoint, payerKeyfile, directory, idl, proofCli,
});
const plan = await client.prepare({label, directory: operationDirectory,
  provisionedDirectory, amount, consumer: {kind: 'merchant', sku: '7'}});
const query = await client.stageQuery(plan, {owner}); // explicit owner + admin approval
await client.submit(plan, query);
// Observe until the real authenticated callback has authorized the operation.
const observation = await client.observe(plan);
if (observation.status === 'authorized') {
  const payment = await client.stageCommit(plan, {owner}); // separate exact owner approval
  await client.submit(plan, payment);
  // Only a complete committed observation proves the paid application effect.
}
```

Retain each returned ticket with the existing private create-only writer before
submitting it. `load`, `observe`, `recover` and `submit` preserve completed plans;
none silently prepares another query or replaces a signed transaction. The
separate `recover-operation.mjs` accepts the same arguments as the legacy
keyless worker, but validates this profile's full state and generated deployment.
It never takes a signing key or native witness.

`payerKeyfile` is the policy administrator used for query co-signing. Applications
must obtain explicit consent for that role as well as the source owner; do not
turn a deployment descriptor's keyfile path into automatic query authority.
`prepare` also signs native preparation using the provisioned source owner's
local keyfile, so preparation is an owner-authorized action.

For a process restart, distinguish reopening an operation from reopening its
transaction journal. `client.load` validates a saved plan; it does not attach a
new connection/session to an old ticket's journal. `client.submit`/`client.recover`
require their sender to use the ticket's original journal. The documented keyless
worker opens `ticket.journalDirectory` and is the supported path for independent
process recovery or explicit retransmission. A fresh signing session may safely
prepare a different explicitly approved operation, but must not restage an old
operation to recover its delivery. See the [separate license application](../../examples/license-app/README.md)
for saved-ticket submission across invocations and the staging-to-ticket-save
interruption limit.

The supported transport is pinned CSplRescueCipher over ScalarField253. Four
cipher slots are always present; unused slots are circuit-checked zero. State is
353 bytes, permit712, Job1200, PreparedAction1200; the native/action template
remains464 bytes and transient hook pointer remains at offset129. Hashes bind
all slots plus release/schema/domain. The client checks live initialized state,
its administrator and runtime public key before preparing/signing a query.
Signed-ticket checks derive every runtime account, including the owning MXE and
computation definition, rather than adopting them from retained instructions.

The descriptor is public configuration, not independent trust. Deployment tooling
must match loaded enforcement ELFs and registered circuit bytes to the release.
Onchain state identity enforces the configured release; mutable program upgrade
authorities remain trusted. This client does not claim to audit arbitrary rules.

`node --test packages/policy-client/test/*.test.mjs` runs synthetic host tests,
including real Ed25519 signing and mocked account/ALT reads. These are not live
native proof verification or distributed execution. Runtime qualification is
recorded separately by the deployment/evidence tools.

### Opt-in explicit approval sessions

New applications can use generated `connectSession`, while existing `connect`
continues to work unchanged:

```js
const session = await connectSession({ deployment, moduleRoot, endpoint,
  directory: '.local/my-approval-session', idl, proofCli }); // no keys
const signers = { ownerKeyfile, administratorKeyfile };
const plan = await session.prepare({ label, directory, provisionedDirectory,
  amount, consumer }, signers);
await session.stageQuery(plan, signers); // durable intent, wire and ticket
await session.submit(plan, 'query');
const observation = await session.observe(plan);
// Following an explicit payment approval and an authorized observation:
await session.stageCommit(plan, signers);
await session.submit(plan, 'commit');
```

Reopen with the same session directory, deployment and endpoint in a new process,
without keys. `load(operationDirectory)`, `observe(plan)` and
`recover(plan, 'query'|'commit')` never sign or broadcast. `discoverApproval`
recovers the original ticket even if the process died before ticket publication;
the caller does not need the original journal path. `submit(plan, role)` expressly
resends those exact signed bytes. It can finish a missing simulation using the
original signatures/blockhash, but cannot renew an expired authorization.

There is one create-only signing attempt per descriptor/role. Concurrent callers
or crashes before signed-record persistence can report
`APPROVAL_INTERRUPTED_BEFORE_SIGNED_RECORD`; this is not permission to stage a
replacement. Multiple candidates report `APPROVAL_AMBIGUOUS`. Read-only discovery
may publish recovered local metadata, but performs no onchain writes. This API is
still the pinned local owner/admin profile, not delegated execution or a production
wallet/session-key feature. See the additive [license sample](../../examples/license-session/README.md).
