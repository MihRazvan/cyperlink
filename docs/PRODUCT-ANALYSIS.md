# CyperLink end-to-end product assessment

Assessed 2026-10-05 against `dff6e12b8e3d398639a0ba4b398e98d52877c9a8`.
This is a source, workflow and retained-evidence review of the current repository.
It proposes priorities; it does not qualify new runtime behavior or change the supported profile.

## 1. Assessment

CyperLink has a working local execution system for **human-approved confidential
spending governed by customer-authored private rules and state**. A browser can drive
the generated SDK through genuine native proof verification, real two-node Arcium
computation, native Token-2022 payment and an atomic paid application effect. Original
policy logic can be authored outside CyperLink core. Durable approvals and recovery
are substantial implemented features, including specific process-crash and RPC-outage cases.

The next product problem is making that system independently operable. A developer
still needs the repository, a carefully prepared host, multiple setup commands,
completed deployment artifacts and local signer files before Console becomes useful.
Failed setup has no general reconciliation workflow. The generated validator launcher
even refuses to restart an existing ledger. Payment recovery must not be mistaken
for recovery of the whole product.

There is also an important application boundary: **private policies are extensible;
application consumers are currently fixed**. The merchant and license programs produce
real onchain entitlements. They do not provide a general consumer integration API,
a commercial catalog/quote system or external fulfillment. Connecting a customer's
actual application remains work beyond writing its spending policy.

| Product layer | Present assessment |
| --- | --- |
| Local confidential execution and enforcement | Implemented and qualified within the narrow local profile. Preserve it as the reference. |
| Local application over the SDK | Working Console for an already completed deployment, with two sources and two consumer types. |
| Independently usable developer product | Incomplete: installation, project/runtime lifecycle, interruption recovery, portable distribution and application integration need work. |
| Product for teams | Incomplete: local process trust and keyfiles do not provide team identity, role separation or shared operations. |
| Production money infrastructure | Unqualified: no supported public-network deployment, real-asset adapter qualification, independent security review or operational service evidence. |

The company direction remains programmable privacy infrastructure for Solana.
Human-approved spending is the implemented offering. Bounded application/agent
permissions remain a separate experiment. Cross-MXE work and broader capacity research
are useful future work, not prerequisites for completing this first local product.

## 2. Review method and evidence boundaries

This review traced authoring, compiler, deployment, bootstrap, native admission,
settlement, generated sessions, local storage and Console source. It compared those
paths with the [architecture](architecture.md), [authoring contract](custom-policy-authoring.md)
and [qualification index](evidence.md). Historical reports describe the revisions
they tested; their passes are not new executions of this commit.

During this assessment, all six archive files named by
[Console v2](../evidence/2026-10-05/console-v2.json)—browser journey, offline review,
keyless recovery, visual checks, deployment and host-test log—were present and their
SHA-256 values matched the published report. This establishes archive correspondence,
not a fresh execution or an independent cryptographic audit.

Four historical raw locations referenced by public reports were **not present at
their recorded paths in this workspace**: `.local/custom-policy-qualification-v20b`,
`.local/license-app-qualification-v21b`, `.local/license-session-qualification-v22b/results.json`
and `.local/license-session-receipt-outage-v23b/results.json`. Their public summaries
and reviews remain tracked. This review therefore relies on those historical reports;
it does not claim to have rechecked their missing raw records. No evidence was deleted
by this assessment, and absence at a recorded path does not establish absence elsewhere.

The preceding cleanup recorded 161 passing maintained JavaScript tests, 65 Python
tests, the cipher-domain check, the Console archive review and a fresh keyless check
of ten loaded ELFs. Those are prior validation results, not tests rerun for this report.
No new payment, deployment, distributed computation or public-network action was run.
This is not a production security audit or a fresh survey of upstream capabilities.

## 3. What is in the product

| Component | Responsibility | Present limit |
| --- | --- | --- |
| [Policy CLI](../packages/policy-cli/cyperlink.mjs) | Initialize, test, build and deploy a customer policy; launch Console. | Repository invocation and local deployment only. |
| [Authoring crate](../crates/policy-authoring/src/lib.rs) | Turn original Rust-authored typed expressions into the authenticated circuit wrapper. | Bounded language and state; pinned compiler internals. |
| [Policy client](../packages/policy-client/src/policy-session.mjs) | Public session lifecycle, approvals, submission, observation and recovery. | Local keyfiles and local runtime profile; no wallet or delegated execution API. |
| [Local proof client](../packages/local-client/src/proofs.mjs) and [proof crate](../crates/client-proofs/Cargo.toml) | Provision native accounts and generate/verify native confidential proofs with local account keys. | Synthetic supported assets and retained local artifacts. |
| [Custom authorization program](../programs/custom-policy/auth/programs/cyperlink_auth/src/lib.rs) | Validate admission, bind immutable Jobs, authorize queries and authenticate callbacks. | Explicit owner/admin authorization and one policy state per deployment. |
| [Guard](../programs/custom-policy/native/guard/src/lib.rs) and [policy hook](../programs/custom-policy/native/policy/src/lib.rs) | Revalidate the exact transfer and atomically consume private state/permit. | Restricted no-fee native adapter and configured hook. |
| [Merchant](../programs/custom-policy/native/merchant/src/lib.rs) and [license](../programs/custom-policy/native/license/src/lib.rs) consumers | Issue the exact paid entitlement in the settlement transaction. | Two reviewed, one-shot application effects. |
| [Console](../apps/console/README.md) | Browser payment inbox, explicit approvals, runtime identity and recovery. | One completed instance per process, trusted local operator. |
| [Bootstrap](local-bootstrap.md) | Obtain pinned tools, build programs/circuits and generate a real local runtime. | Host prerequisites, manual service lifecycle and no retained-ledger restart command. |

The older fixed-allowance programs, budget circuits and checked-in build artifacts
remain bootstrap dependencies. Their continued presence is not evidence of two
competing product directions, and deleting them would break the current setup path.
Archived Approvals, direct-client and Permissions workflows remain available through
the reference Git tags described in [the evidence index](evidence.md#archived-workflows).

## 4. End-to-end developer journey

### 4.1 Install and start the runtime

The documented path installs JavaScript/native tooling, rebuilds baseline circuits,
builds programs, prepares a fresh runtime, starts a validator and starts Docker
Compose before customer deployment. It no longer requires the original research
checkout or copies its identities. It verifies pinned public artifacts; read-only
public RPC used to obtain them is not public-network product execution.

Exact pins include Node 24.12.0/npm 11.6.2, host Rust/Cargo 1.95.0, authorization
Rust 1.89.0, Arcium/Arcis 0.15.0, native proof SDK 7.0.1, Agave validator 4.3.0,
SBF launcher 3.1.14 and platform-tools v1.57 with architecture v0. The qualified host
is Darwin ARM64 with Linux AMD64 Docker support and existing Rust/SBF caches.
Blank-machine installation and additional operating systems have not been demonstrated.
See [bootstrap](local-bootstrap.md) and [toolchain details](local-toolchain.md).

Custom deployment explicitly disables the pinned SBF-v0 deployment restriction at
fresh local genesis. That exception must stay visible: this runtime is not evidence
of default network feature parity or public deployability. Upstream generation probes
port 8899 even with another requested RPC port; the validator also uses faucet port
9900. These constraints complicate running several environments.

**Lifecycle gap:** [the generated launcher](../scripts/prepare_localnet.py) exits with
`Ledger exists; never reset evidence` whenever its ledger already exists. This is a
valuable protection against accidental replacement, but the supported wrapper offers
no safe resume mode. Stopping the stack is documented; restarting that same stack
through the documented launcher is not supported. This source finding is distinct
from the qualified restart of Console while its validator remains running.

### 4.2 Author and test a policy

`policy init` creates a customer directory containing `policy.rs`, `policy.json`
and `tests.json`. Customer code constructs original private expressions; the package
name or an example selector does not determine its behavior. The maintained examples
include budget/count and minimum-reserve policies with different state transitions.

The [language contract](compiler-gate.md) supports one to four named private u64
fields; comparisons, Boolean composition, selection and checked addition,
subtraction and multiplication. Four encrypted slots are always present. Arithmetic
failure denies the operation and preserves the prior plaintext state, including when
the invalid expression belongs to an unselected branch.

This is intentionally narrower than general Rust or general confidential computation.
There are no extra private inputs, dynamic state, private variable loops, division,
time oracle or external facts. The policy receives authenticated payment amount and
its own state; it cannot currently branch on a supplied SKU, product or arbitrary
customer context. Source and constants are public. Confidential thresholds belong
in encrypted state, not source literals.

`policy test` runs actual customer code through the host expression model with
synthetic vectors, including supported binding-error cases. That is useful policy
testing, but it does not execute a native payment or distributed computation.
Customer Cargo code runs as trusted local code, with the host environment and filesystem;
there is no sandbox for a hosted service compiling untrusted submissions.
The subprocess runner also has no execution timeout or resource ceiling. Future
progress/cancel controls need a process-lifecycle contract: stopping a deployment
process does not undo its already-landed transactions.

### 4.3 Build a release and generated bindings

The [package builder](../packages/policy-cli/src/package.mjs) stages the customer
source and locked compiler dependencies, builds initializer/evaluator circuits and
records all eight artifacts. Release identity covers the manifest, source, schema,
selected platform source and artifacts. Generated bindings expose the policy-specific
deployment and session contract.

The cipher-domain problem was handled without weakening native binding. The wrapper
uses ScalarField253/CSplRescueCipher, authenticates all 32 native commitment bytes with
the full opening and enforces amount below `2^48`. High-level Arcis's
BaseField255/RescueCipher is not interchangeable. The typed-expression fallback is
implemented, not a proposed shortcut; [the compiler contract](compiler-gate.md)
and [gate evidence](../evidence/2026-10-02/compiler-gate.json) retain that distinction.

Three release-product gaps remain:

- Building does not run policy tests, and deployment does not require a passing test
  record bound to the release. “Compiled,” “tested” and “deployed” need separate states.
- Bindings import the SDK through an absolute repository path. Release identity is
  path-independent, but moving generated bindings to another machine is not a supported
  portable-package workflow. The JS packages are private and use repository-relative dependencies.
- Publication uses several filesystem steps. The release directory is renamed before
  `release.json` is written, followed by current-release/binding writes. Source inspection
  identifies a potential interrupted-publication state; no crash qualification or repair
  workflow for that boundary was found. This is an untested lifecycle finding, not a
  reproduced failure or a payment-binding defect.

The platform-source hash covers a selected enforcement/compiler source set. It is
not a hash of the entire CLI, SDK, bootstrap, toolchain and distribution supply chain.
Those components need their own versioned release/provenance contract.

### 4.4 Deploy and provision

The [deployer](../packages/policy-cli/src/deploy.mjs) verifies release artifacts and
the local environment, generates isolated policy program identities and establishes
the Arcium application encryption domain (MXE) and private state. It checks actual
loaded program bytes and uploaded circuit/interface
bytes. Private initialization uses a real authenticated runtime callback. It then
provisions synthetic native assets and publishes a ready instance for the SDK.

Each current deployment has its own quota, MXE, generated authorization/guard/policy/
merchant/license programs and mint. Two owners can compete for shared private state.
This is useful isolation; it is not arbitrary routing among policies over an existing
customer mint. Provisioning uses fixed synthetic asset assumptions, including zero
decimals and test funding. Instance records also retain machine-specific tool/artifact paths.

Deployment retains failure phases and outputs, but refuses output reuse rather than
reconciling a partially completed instance. There is no general resume, policy upgrade,
private-state migration or allowance-administration workflow. A deploy button alone
would expose these limitations without solving them.

### 4.5 Connect the SDK and Console

Generated `connectSession` bindings provide real APIs for preparation, staged
approvals, discovery, submission, observation and recovery. A session can connect
without signer keys. Signing paths require explicitly selected owner and administrator
keyfiles; Console does not silently treat the deployment payer as user approval.

[Console's adapter](../apps/console/adapter.mjs) verifies the completed instance,
generated bindings, circuit artifacts and ten loaded ELFs before use. The local server
binds to `127.0.0.1`, checks exact host/origin, uses a local session cookie and protects
mutating requests. It supplies sanitized projections to the browser. These are useful
local application protections, not multi-user authentication or team authorization.

The UI has a payment inbox, explicit review, separate query/payment approvals and
retained recovery. It currently exposes two provisioned sources and merchant/license
effects. It cannot create/build/deploy projects, switch an organization among projects
or repair incomplete setup. Amounts are raw base units; license products are hex IDs
and expiry is an absolute slot. These are precise developer controls, not a finished
customer checkout or application catalog.

### 4.6 Prepare the native operation

Preparation is consequential: it uses the local proof client and account keys to
create and verify native proofs, upload proof material, establish the consumer account,
assign a unique permit and create an owner-authorized immutable PreparedAction. It
then publishes the operation plan and encrypted computation input. This is not a
read-only preview. [Preparation source](../packages/policy-client/src/operation-client.mjs)
shows why it requires explicit authorization.

The account-wide decryption keys stay in the local proof client. The operation's
ephemeral encrypted amount/opening input is a different object. No fixture-key
circuit, injected verified context or preauthorized permit substitutes for this path.

Preparation interruption before publication of the final plan is **outside** the
qualified approval-ticket crash window. Console fails closed instead of repeating it.
A product needs to reconcile already-created artifacts and explain the next safe step;
silently starting preparation again is not recovery.

### 4.7 Authorize the private query

Owner and administrator approve one query. Before exposing a private decision,
[admission](../crates/native-admission/src/lib.rs) checks native proof ownership/type/
relationships, account and extension profile, keys, funding/source subtraction,
successor relationships, auditor ciphertexts and the selected amount commitment.
The immutable Job binds the owner, exact native action, source prestate, consumer
action, private input, state version and unique permit/computation assignment.

This closes the earlier research gap where the selected amount commitment was
authenticated without validating the full supported native proof/account/funding
relationship. It does not imply support for arbitrary Token-2022 extensions.

Real Arcium computation checks the native commitment opening and evaluates the
customer policy. The callback verifies the runtime association and signed output
before admitting the permit. The allowance result is public. A valid query may
disclose allow/deny even if the user never pays; owner/admin authorization is the
current disclosure boundary. There is no general automated query-access, privacy-budget
or delegated-query service.

An accepted query advances nonce allocation; settlement advances private-state
version. Neither a valid query nor an allow callback reserves funds or shared capacity.
Another query can invalidate a delayed signed query through counter drift; another
payment can invalidate a permit through source/state drift. Fresh recomputation must
remain a new, explicitly authorized operation.

### 4.8 Settle and produce the application effect

Settlement separately requires approval. The guard rechecks native validity and
the bound source prestate, arms the restricted hook, performs the native transfer,
consumes the encrypted predecessor/version and permit, then completes the exact
consumer effect. A later consumer failure rolls back all these application-account
changes in the same transaction. Transaction fees remain a separate payer cost.

The merchant record binds a buyer and one-time SKU. The license record binds a buyer,
product and expiry, currently limited to at most 1,000 slots ahead at settlement.
Both are one-shot issuance: an expired license is not automatically renewable.

These are **actual paid onchain entitlements**, but the reference programs do not
define an independent merchant price registry or signed commercial quote. Binding
the user's exact amount and product prevents substitution; it does not independently
establish that the merchant agreed to that price. Nor does the entitlement itself
serve software, unlock an external service or establish the user's offchain identity.
A sellable integration needs an explicit commercial-terms and fulfillment contract.

The current manifest and authorization path allow only merchant/license consumers.
Supporting a new paid application effect requires core program/integration work and
new qualification. That does not negate original policy authoring, but it materially
limits which applications can integrate without help.

### 4.9 Observe, recover and continue

The SDK separates three facts: payment/application effect, transaction delivery,
and whether the entitlement is usable at the observed slot. An unavailable receipt
does not mean payment failed; an expired license stays historically paid.

Signed approval attempts are retained before signing proceeds. Recovery validates
the original wire bytes, signatures, action, ledger and lookup resolution and can
discover a ticket lost after signed staging. `recover` never simulates or broadcasts.
Explicit submission can continue only with the retained original transaction; it
cannot replace its blockhash, nonce, terms or expiry. Recognized RPC availability
failures can fall back to bound account evidence. Contradictory or malformed evidence
fails rather than being reclassified as an outage.

The [session implementation](../packages/policy-client/src/policy-session.mjs) reads
related accounts from a common bank and retains observation floors across restarts.
At one state version ahead it checks the full successor. At later versions it relies
on the consumed bound permit and exact effect under the trusted atomic programs,
not a reconstructed history of every intermediate state.

Keyless recovery still needs retained local plans/journals and RPC access; it is
neither stateless nor offline. Console also reads retained operation material to
check the displayed intent. Local files have restrictive permissions and durable
publication patterns, but there is no backup/restore, device migration or key-vault
product. Losing account decryption keys is not solved by retaining a signed ticket.

## 5. Recovery coverage and remaining lifecycle holes

| Boundary | Implemented behavior | Remaining product work |
| --- | --- | --- |
| Query/payment signed, ticket not saved | Qualified discovery of retained original bytes after selected SIGKILL points. | Preserve this contract when adding signer adapters and new storage. |
| Crash before signed publication | Refuses automatic restaging. | Explain remediation without inventing a new authorization. |
| Receipt unavailable, bound accounts readable | Qualified independent committed-effect observation. | Distinguish missing, pruned, unavailable and contradictory evidence in stable public errors. |
| Receipt and accounts unavailable | Unresolved current state; known historical payment retained. | Operator diagnostics and outage workflow, not automatic recharge. |
| Terminal unpaid stale request | Console permits separately approved fresh intent and retains supersession. | General application contract beyond the local inbox. |
| Preparation before final plan | Fails closed; no general reconciliation. | Recover proof/context/permit/action artifacts without double preparation. |
| Build or deployment interrupted | Staged files/failure output retained; no general resume. | Durable phase journal, identity reconciliation and repair/resume commands. |
| Console hard crash | Workspace lock retained; manual verified removal. | Safe ownership/recovery UX without unsafe PID-only lock stealing. |
| Validator/runtime stopped | Existing-ledger launcher refuses startup. | Explicit retained-runtime resume with identity/state checks. |
| Keys, workspace or machine lost | No qualified product recovery. | Backup/restore and key-custody contract with clear irreversible-loss limits. |

Console deduplication is local to one workspace and business purchase identity.
Paid or unresolved purchases block another charge there; a new workspace is not a
safe retry mechanism. The workspace holds at most 500 intents, the approval store
has a 4,096-file discovery bound, and no compaction service exists. Polling observes
retained plans and mutations are serialized. This is sufficient for the reference,
not a qualified high-volume transaction service.

Cancellation exists onchain and is recognized by observation, but is not exposed
as a complete public session/Console action. There is no general allowance refill,
policy migration, entitlement refund/revocation/renewal or finished account/rent
retirement workflow. Successful proof-buffer cleanup should not be confused with
full lifecycle cleanup for Jobs, permits and proof contexts.

## 6. Privacy, authority and supported asset boundary

| Boundary | What can currently be claimed |
| --- | --- |
| Account keys | Account-wide decryption keys remain with the local client. Current operation assumes a trusted local host/process and local signer files. |
| Private data | Native balances and policy state are encrypted. Amount entered in Console is visible to its user/local process. Policy code/constants, identities, metadata, allow/deny and entitlement terms are not universally hidden. |
| Query authority | Owner plus administrator authorize disclosure for one exact operation. This is neither autonomous delegation nor an unrestricted preview endpoint. |
| Settlement authority | Exact owner-authorized native action plus unique authenticated permit; administrator remains part of the local signing/funding setup. |
| Runtime | Real two-node Arcium execution on one host/operator setup. Independent operators, recovery ceremonies and production availability are unqualified. |
| Deployment authority | Program/circuit authorities, administrator, local RPC and local OS remain trusted. Artifact hashes establish correspondence, not removal of those authorities. |
| Finality/evidence | Confirmed local RPC receipts/account observations. Offline reviews are not independent BLS verification or historical consensus proofs. |

The supported asset profile is synthetic local Token-2022 confidential transfers
with the configured hook and ordinary owner signing. It excludes transfer-fee
extensions even at zero bps, CPI Guard extensions, native delegates/multisig and
unsupported extensions/hooks. AUSD needs a separate fee-aware adapter. Arbitrary
real assets or wallet custody cannot be advertised by analogy to this profile.

The separate [Permissions experiment](../evidence/2026-10-02/permissions-native-escrow-v3.json)
demonstrated dedicated native escrow authority and a fresh executor-only transfer,
with selected revoke/refund cases. It does not integrate private policies/query
authorization into the present SDK. Replaying owner-signed transactions or placing
an automatic signer in front of the owner's key would not fill that gap.

## 7. What the execution evidence proves

| Evidence | Material result | Qualification limit |
| --- | --- | --- |
| [Custom policies v20b](../evidence/2026-10-02/custom-policies-v20b.json), [review](../evidence/2026-10-02/custom-policy-v20b-offline-review.json) | Two different policies, isolated MXEs/mints, two initializer and ten evaluation callbacks, two paid effects; 22 landed rejections and 319 rollback account comparisons. | Historical local report. Some binding/corruption checks are host checks; do not call every negative case a landed rejection. Raw location unavailable in this workspace. |
| [Paid license v21b](../evidence/2026-10-03/license-app-v21b.json) | Five authentic decisions, two paid licenses, stale/rollback/replay and recovery cases. | Internal integration required source assistance; not an unaided customer integration. |
| [Sessions v22b](../evidence/2026-10-03/license-session-v22b.json) | Query and payment each survive interruption after signed persistence and after simulation/before ticket save; two paid licenses. A fifth prepublication interruption fails closed. | Specific crash boundaries, not arbitrary provisioning or disk-loss recovery. |
| [Receipt outage v23b](../evidence/2026-10-03/license-session-receipt-outage-v23b.json) | Keyless observations preserve payment through selected faults without sending transactions. | Restored RPC returned a pruned/null receipt. It did not demonstrate receipt restoration. |
| [Console v2](../evidence/2026-10-05/console-v2.json), [review](../evidence/2026-10-05/console-v2-offline-review.json) | Browser through generated SDK: four callbacks, one paid merchant, one paid license and explicit stale supersession; separate keyless process recovered the actual original receipt after faults. | Existing retained local runtime and completed instance. Six accounts and 75 immutable files unchanged; zero send/simulate calls during recovery. Not a rerun of every earlier crash/rollback case. |
| [Direct upstream comparison](../evidence/2026-10-03/license-direct-v22c.json) | Selected matching payment/failure cases using pinned upstream client tools and shared enforcement. | Shared compiler, native bridge, provisioning and programs; standalone equivalence and comparative customer advantage remain inconclusive. |

Console's archive review checked ten signed messages, 16 Ed25519 signatures, four
callbacks and both exact paid effects. It recorded ten matching loaded ELFs. The
synthetic allowance changing from 40 to an inferred 20, cap 40 and entered test
amounts are explicitly **test-observer disclosures**, not a decrypted balance API.

The v20b review's thousands of signed messages include deployment and provisioning;
they are not thousands of successful payments. Current source and future changes
must retain their own qualification. Reference tags remain useful for reproducing
historical code, but do not restore missing private runtime archives or identities.

## 8. Costs, performance and operating model

The Console report records these selected local receipts:

| Stage | Transactions | Total landed Solana CU | Synthetic fee lamports |
| --- | ---: | ---: | ---: |
| Query admission | 4 | 735,602 | 40,000 |
| Arcium callback | 4 | 623,712 | 20,000 |
| Settlement | 2 | 168,456 | 20,000 |

These totals exclude native preparation, deployment, provisioning, rent, compilation
and distributed-computation infrastructure. They cannot be presented as complete
per-payment pricing, public-network fees or company gross margin.

The two-policy v20b qualification recorded 6,775 circuit-upload transactions, 2,038
program-deployment transactions and 132 native proof/operation provisioning
transactions across its scenario matrix. These are observed run totals, not a claim
that every purchase needs that workload. They nevertheless make deployment progress,
resumption and cost attribution important product capabilities.

Its measured query-staging-to-observed-callback intervals were approximately
19.0–20.4 seconds. They include lookup-table/finality/RPC work and observation;
they do not isolate MPC latency or establish an SLA. Compiler modeled ACUs,
Solana CU and wall-clock/runtime costs are different measurements.

No current evidence establishes throughput, p95/p99 latency, multi-tenant capacity,
cost under retries or sustained workspace/journal growth. Shared state and query
counter checks imply contention between competing operations; that is an architectural
expectation, not a measured capacity result. Reservations or automatic recomputation
would change authorization semantics and should not be introduced as UI optimizations.

## 9. Prioritized product gaps

Priority here means dependency order for an independently usable local product,
not a vulnerability severity rating.

| Priority | Gap | Consequence | Smallest useful completion criterion |
| --- | --- | --- | --- |
| First | Runtime identity, readiness and safe restart | A user can stop a working stack but cannot resume it through the supported launcher. | Start/inspect/stop/resume one retained environment without resetting ledger, keys or approvals; verify genesis, features, artifacts and preserved application state. |
| First | Durable project/deployment/preparation lifecycle | Partial work is retained but frequently requires source-level diagnosis or a new output. | Reconcile interrupted phases and either resume the original operation or explain a terminal outcome without duplicate identities/authorizations. |
| First | Tested-release identity and portable project contract | Build success can be mistaken for policy correctness; bindings depend on a checkout path. | Bind test results to source/release, expose lifecycle states and reproduce the same project from documented portable inputs. |
| Next | Real application integration contract | A paid reference record does not yet integrate an arbitrary customer service. | One documented entitlement verification/access integration, authoritative commercial terms and explicit limits on custom consumers. |
| Next | Signer and key lifecycle | Local co-located files are not how independent users/admins approve. | Versioned signer/proof-provider interfaces preserving client key custody and exact-message approval; qualify cancellation, expiry and recovery for the chosen adapter. |
| Next | Backup, retention and bounded storage | Current recovery depends on files whose availability is not managed as a product. | Inventory/export/restore project identities, journals and evidence securely; exercise restoration and surface capacity limits before failure. |
| Next | Errors, diagnostics and release checks | Generic unresolved errors and script logs require specialized help. | Structured errors with safe next actions, redacted diagnostics and repeatable maintained checks. |
| Before teams | Identity, roles and tenant/workspace isolation | Local origin checks cannot authorize separate people or organizations. | Define project membership, owner/admin separation, audit history and isolation before hosting or shared access. |
| Before production funds | Asset/network/security/operations qualification | Local synthetic success says too little about real money operation. | Explicit profile-specific network/asset validation, authority/key model, independent review and operational recovery evidence. |

There is no tracked CI workflow or top-level distribution license in this checkout.
That is a release-hygiene observation, not proof that no external checks exist.
Before publishing a developer package, decide distribution terms, supported platforms,
API/schema versioning and a reproducible release check. No new dependency versions are
needed merely to complete this lifecycle work.

## 10. Recommended milestones and acceptance gates

### Milestone 1: An operable local project

Build a single runtime/project lifecycle behind CLI and Console. Begin with read-only
readiness and explicit retained-runtime resume, then expose project creation,
test/build/deploy progress and recovery through that same service. Keep expensive
or signing actions explicit. Retain the currently passing Console as the reference.

The first experiment should use a **separate local environment**, make one real paid
operation, stop its validator/Arcium/Console processes, and resume that same environment.
Verify the same genesis and identities, ten loaded ELFs, unchanged tracked application
accounts, original operation bytes and keyless paid observation. Confirm application
startup triggers no new owner/admin transaction signing, query admission, simulation
or settlement; normal runtime-node signing is a separate activity. Then explicitly authorize a
fresh operation to show that resumed distributed execution still works. Fail closed
on conflicting processes, identity mismatch or incomplete runtime state.

Completion of the milestone additionally requires an interrupted build/deploy/prepare
matrix, actionable error states and a demonstrated setup from the documented supported
host prerequisites. Clean-machine installation must be tested separately; a new
directory on the existing cached development machine is not that test.

### Milestone 2: A usable application integration

Deliver a portable project/package contract and an application example that verifies
the paid entitlement before granting actual access. Specify who authorizes product,
recipient, amount and expiry, and bind those terms through the exact payment. Decide
whether the first release offers only the two reviewed consumers or a versioned
custom-consumer interface; do not imply the latter already exists.

Run both materially different customer policies through the same tooling. Demonstrate
policy denial, compatible spending, competing stale authorization, explicit fresh
recomputation, atomic rollback and retained-wire recovery. Include commercial-terms
and access failures in addition to the native payment cases. No core edit should be
needed for a new rule within the documented language.

### Milestone 3: Independent identities and team operations

Choose and implement a concrete signer/proof-provider integration rather than a
generic “wallet support” claim. Keep account decryption keys client-side and separate
owner consent from administrator admission. Qualify exact-transaction recovery with
the chosen signer, then project backup/restore, cancellation, key lifecycle and team
roles. A hosted compiler or shared Console introduces new trust boundaries and must
not reuse trusted-local assumptions silently.

### Milestone 4: Broader deployment and production readiness

Select the actual asset/network profile and validate its extensions, features,
deployment permissions and fee behavior. Establish authority management, operational
monitoring, runtime recovery, capacity/cost measurements and independent security review.
Public-network execution and real funds remain separately authorized work.

Only bring autonomous permissions into this path after the dedicated authority,
private-proof access, authorized-query, expiry/revocation and recovery contract is
integrated and qualified. Cross-MXE composition, arbitrary private programs and broad
asset support remain extensions rather than hidden dependencies of the first release.

## 11. Definition of the first working product

A developer should be able to create an original policy project, understand and run
its tests, obtain an identifiable release, deploy it into a supported local environment,
connect its application, explicitly approve a genuine confidential payment and observe
the paid application effect. They should then be able to stop and restart the system,
recover the same operation and diagnose an interrupted setup without hand-editing
core code, ledgers or approval journals.

The current repository already supplies the essential cryptographic, native execution
and transaction-recovery foundation for that product. Completing project/runtime
lifecycle and application integration is the shortest path from this foundation to
something developers can use independently. No production credentials, private RPC
or real funds are needed for the next local milestone.
