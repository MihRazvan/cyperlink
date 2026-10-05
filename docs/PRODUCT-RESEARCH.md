# CyperLink: research for a usable programmable-privacy product

Research date: **2026-10-05**. Repository baseline: `2e2990f`.
This report complements [the implementation assessment](PRODUCT-ANALYSIS.md): that
document describes what exists; this one investigates what we need to deliver the
mission, why those requirements matter, and how to resolve the remaining uncertainty.

## 1. Mission and research conclusion

**Make private money programmable on Solana:** let applications enforce original
rules over confidential payments and shared private state, while users retain their
account-wide decryption keys and the exact authorized payment, state consumption and
application effect commit atomically.

The first offering is human-approved confidential spending. The second is bounded
spending authority for applications and agents, once authority, proof access, query
disclosure and recovery have been integrated. Customer-authored private policies are
part of both offerings, not a menu of preset allowance templates.

The research supports continuing this direction, with a sharper product boundary:
**CyperLink should own the reliable authorized-operation contract across native money,
private computation and application effects.** Upstream projects already supply
confidential token tooling, private execution and developer frameworks. A wrapper or
transfer builder alone is unlikely to provide durable differentiation.

Five findings matter most:

1. **There is a plausible public-network path, but no CyperLink public qualification.**
   Current Solana documentation says its native proof program is enabled on mainnet
   and devnet. Our local feature exception, deployed bytes, asset configuration and
   compiler target still require their own compatibility work.
2. **Native custody and application integration are central requirements.** Wallet
   signing, confidential proof access, private query authorization and paid service
   delivery are different capabilities. A wallet connection does not implement them.
3. **Privacy infrastructure has substantial competition.** Private compute, custom
   policies, scoped disclosure and spending limits already exist in adjacent products.
   We must demonstrate an advantage for a specific operation and customer boundary.
4. **Lifecycle reliability is part of the product's value.** Installation, retained
   runtime restart, deployment reconciliation, key restoration and application recovery
   must work without the developer studying our implementation.
5. **A managed service is a separate operating model.** Customer-held keys do not
   automatically resolve authority, availability, legal or team-access responsibilities.

The next engineering milestone remains an operable local project. This research
adds concrete upstream reuse opportunities and acceptance criteria; it does not
justify replacing the tested cryptography, broadening the asset claim or pivoting away
from Solana. Sources for these conclusions are developed below.

## 2. What is evidence, and what is a proposal

**Implemented:** the repository has original typed policy authoring, real native
proof admission, authenticated Arcium callbacks, exact settlement, two paid reference
consumers and selected crash/outage recovery. Its synthetic local profile and limits
remain those in [architecture](architecture.md) and [evidence](evidence.md).

**Externally documented:** upstream functionality and competing offers described by
the primary sources linked here. Reading a vendor's documentation establishes what
it documents, not our independent verification of its implementation or performance.
All web sources were retrieved on 2026-10-05 unless a historical publication date is
explicitly mentioned. Unversioned pages can change.

**Proposed:** interfaces, architecture boundaries, commercial models, experiments
and acceptance gates below. None becomes implemented or production-qualified by
being included in this report. No new runtime or wallet integration was executed.

**Unknown:** willingness to pay, outside-developer usability, full upstream comparison,
public-network compatibility and production operating cost. No customer commitment,
contact, paid research, real-fund transaction or public-network write occurred.

Research used current primary documentation/code, public
[Grid product and organization records](https://beta.node.thegrid.id/graphql), and
the preserved customer-workflow research/mailbox. Grid metadata was useful for entity
discovery but incomplete or older than live product docs: for example, its Arcium
record says early access while Arcium publishes mainnet deployment documentation.
No matching Umbra record appeared in the bounded Grid query; that is not evidence of
absence from the market. Protected Colosseum history was unavailable because its
connection helper was not installed; no login or installation was needed to continue.

## 3. Who the product should serve first

The technical first user and the eventual economic buyer need not be identical.
The following are **customer hypotheses**, not evidence of demand for CyperLink.

| Candidate | Job worth investigating | Why our current work fits | What could disqualify the fit |
| --- | --- | --- | --- |
| Solana application developer | Sell access or admit a funded action under private shared rules. | Closest to the customer-policy and atomic paid-effect reference. | Needs arbitrary assets, subsecond responses, participant anonymity or application inputs we cannot authenticate. |
| Wallet/custody infrastructure team | Add confidential business operations without exporting account-wide keys or replacing its controls. | Native asset/control boundary is strategically relevant. | Existing upstream orchestration is sufficient; their signer/proof system cannot support our authority model. |
| Business payment platform | Bind approved business terms to confidential settlement and useful records. | Operation evidence and recovery could integrate into an existing workflow. | Its main need is hiding counterparty relationships or fiat payout rather than native amount/private-state enforcement. |
| Agent/application platform | Allow fresh bounded spending without asking the owner each time. | Permissions experiment provides a separate starting point. | Requires unbounded proof access, owner-key automation or delegation incompatible with native confidential accounts. |

There is attributable engineering activity around native confidential assets.
BitGo merged [Solana confidential transaction construction and operations](https://github.com/BitGo/BitGoJS/pull/9809)
on September 29, 2026. That is evidence that instruction assembly and custody integration
are being built upstream; it is neither a CyperLink lead nor proof of production usage.
The [Token-2022 CLI tracking issue](https://github.com/solana-program/token-2022/issues/1493)
lists remaining integration work such as custom keys, offline operations and complete
transaction output. Its individual task statuses can change; missing CLI conveniences
do not mean the underlying native instructions are unavailable.

**Recommendation:** complete a narrow developer product around paid application
access and shared confidential rules, while designing signer/proof boundaries that
could fit wallet infrastructure later. Keep wallet/custody teams as a strategic
customer hypothesis from the earlier research. Do not build a new treasury suite,
custodian, on/off-ramp or consumer wallet as prerequisites.

Before a real pilot, answer five questions with the prospective user: what must stay
private, from whom, which asset and authority they use, what paid effect must occur,
and what they would otherwise build. The current user has deferred onboarding until
the product works; prepare this intake now, conduct it only when authorized.

## 4. Competitive baseline: what we cannot assume is unique

This is a comparison of documented offerings, not a hands-on benchmark. None of
these projects is a confirmed partner, integration or buyer.

| Alternative | Relevant documented capability | Implication for CyperLink |
| --- | --- | --- |
| [Native Token-2022 integration](https://solana.com/docs/tokens/extensions/confidential-transfer/integration-guide) | Client proofs, key handling and high-level confidential-operation helpers. | Compete on authenticated application/state integration and lifecycle guarantees, not basic transaction construction. |
| [Arcium](https://www.arcium.com/build) | Original confidential programs, local build/test and deployment; C-SPL is part of its confidential-asset direction. | An upstream dependency can also absorb adjacent functionality. Our value must exceed exposing its CLI. |
| [Helius Rings](https://www.helius.dev/docs/privacy) | Beta/devnet private transfers and escrow, owner signatures, custom Ring policies and several asset types. | Strong overlap with programmable privacy. Compare custody, native-account continuity, policy expressiveness and recovery instead of claiming exclusive composability. |
| [Inco on Solana](https://docs.inco.org/svm/home) | Beta confidential Anchor programs with private types and programmable access control. | Original private logic alone is not unique. Verify differences at the actual payment/state/consumer boundary. |
| [MagicBlock PER](https://docs.magicblock.gg/pages/private-ephemeral-rollups-pers/introduction/onchain-privacy) | Intel TDX-based private execution and account access control. | A different execution/trust model may better fit some latency or application needs. No comparative performance claim is established here. |
| [Umbra examples](https://github.com/umbra-defi/examples) | Scoped viewing keys and selective auditor grants; its [live product](https://www.umbraprivacy.com/) presents private financial flows. | Selective disclosure is prior art. Compare exact key scope and application integration; do not conflate this Solana product with similarly named Ethereum projects. |
| [Squads spending limits](https://docs.squads.so/main/navigating-your-squad/settings/spending-limits) | Member authority bounded by account, token, amount, period and destinations. | Bounded authority already has a usable model. Confidential proof access and private query permission are the additional problems we must solve. |
| [Request Finance private payments](https://help.request.finance/en/articles/12958312-private-payments-overview) | A custodial-partner workflow using separate addresses and payout timing to obscure business payment relationships. | A customer may prefer a complete financial workflow over native cryptographic composability. Its privacy boundary differs from public native account participation. |

**Differentiation hypothesis:** customers who need to retain native confidential
accounts and their own key/control boundary will value original shared private logic,
exact-action settlement and dependable operation evidence enough to adopt CyperLink.
This is credible but unproven. Native accounts do not confer an advantage for customers
who do not care about that boundary.

Repeat the direct-upstream comparison only after both sides use equivalent guarantees:
native amount/proof admission, original policy, shared state, owner/query authority,
paid effect, stale rejection and interruption recovery. Record application-specific
work separately from reusable infrastructure, required expertise, assistance and
failure handling. The existing shared-core comparison remains **inconclusive** for
a full standalone replacement or customer productivity advantage.

## 5. Upstream findings that change requirements

### 5.1 Network availability is documented; exact compatibility remains a gate

The current [Solana transfer guide](https://solana.com/docs/tokens/extensions/confidential-transfer/transfer-tokens)
says the ZK ElGamal Proof program is enabled on mainnet and devnet. The
[Token-2022 status page](https://www.solana-program.com/docs/token-2022/status)
describes deployed confidential functionality and its runtime dependency. A separate
[Foundation skill reference](https://github.com/solana-foundation/solana-dev-skill/blob/main/skills/solana-dev/references/confidential-transfers.md)
still describes a restricted test-cluster path. Keep that contradiction visible;
the current product guides supersede treating a historical shutdown as a present
universal blocker. This research did not inspect live cluster features or send a transaction.

**Requirement:** a versioned compatibility manifest must identify genesis, feature
requirements, Token-2022/proof/Arcium interfaces, program bytes, transaction format,
compiler/loader target and asset extensions. A release is compatible only with
profiles actually qualified. A read-only network inventory is a precursor to a
separately authorized execution test, not its substitute.

The [SBF build project](https://github.com/anza-xyz/cargo-build-sbf) documents the
transition to SBFv3 and deployment restrictions for older targets. CyperLink's
local SBF-v0 exception remains material. Preserve the passing build and probe a new
target in isolation if necessary; do not silently replace pins with current releases.

### 5.2 Asset distribution is not just an SDK feature

Native confidential support requires mint configuration; the relevant extension
cannot simply be added to an existing mint after initialization. Accounts also need
their confidential configuration and any issuer approval. Incoming funds may need
pending-balance application before spending.
[Upstream confidential-balance lifecycle](https://www.solana-program.com/docs/confidential-balances).

**Requirement:** supported-asset onboarding must cover mint and account extensions,
issuer/account approval, auditor visibility, recipient readiness, funding, applying
credits and withdrawal. If users need to acquire or redeem an asset through another
provider, expose that requirement and its eligibility/fees rather than assuming they
already hold suitable confidential funds.

The configured transfer hook is another distribution dependency: a customer SDK
cannot unilaterally change an issuer's mint configuration. Before selecting a real
asset, establish whether its authority and hook model can support CyperLink. Agora's
[deployment directory](https://docs.agora.finance/developer/contract-deployments)
identifies AUSD contracts; it does not prove CyperLink compatibility or user approval.
**AUSD remains unsupported by the current adapter.**

Fee-aware native instructions and confidential mint/burn introduce different flows;
the latter disables the public deposit/withdraw path.
[Solana integrator guide](https://solana.com/docs/tokens/extensions/confidential-transfer/integration-guide).
Our proposed fee adapter must explicitly bind gross debit, fee and net receipt to
policy and seller terms, including rounding, caps and schedule changes. A fee extension
at zero bps still needs that adapter; accepting it as no-fee would broaden the contract.

### 5.3 The cipher bridge should remain intact

Arcium exposes both scalar-field `CSplRescueCipher` and base-field `RescueCipher` APIs.
The APIs target different fields and do not establish interchangeability.
[Arcium client API](https://ts.arcium.com/api/client).
The repository's tested typed-expression wrapper therefore remains the implementation
path. High-level Arcis source support is a separate compatibility project, not a
prerequisite for useful original policies.

Any language extension must retain full commitment/opening authentication, native
amount bounds, nonce uniqueness, encrypted successor binding and fail-closed arithmetic.
Additional inputs need an authenticated source and schema. A user-provided SKU, oracle
value or timestamp cannot become trusted policy input merely by appearing in the UI.

### 5.4 Reuse upstream lifecycle capabilities where compatible

Arcium's current deployment guide documents partial/resumable initialization and
deployment, MXE authority transfer, migration, retirement, public cluster offsets and
hash-verified externally stored circuits. These are possible building blocks, not
features already exposed by CyperLink. The guide also ties fresh MXE initialization
to program upgrade authority and specifies recovery-set requirements.
[Arcium deployment](https://docs.arcium.com/developers/deployment).

**Recommendation:** inventory these capabilities against pinned 0.15.0 before writing
new orchestration. Wrap compatible primitives in our durable identity/reconciliation
contract. An upstream resume command alone cannot reconcile CyperLink's generated
programs, native assets, private initializer and operation artifacts.

Externally stored circuit bytes could reduce upload transactions. Probe exact hash
verification, content unavailability and reproducibility locally before changing
the reference. Public artifact distribution is compatible with our current public
policy-code model; it does not mean publishing private state or account keys.

### 5.5 Preprocessing trust and availability need explicit profiles

The September 14, 2026 [Arcium 0.15.0 release notes](https://docs.arcium.com/developers/release-notes)
make distributed preprocessing opt-in; earlier configurations retain the trusted
dealer. Our [runtime configuration](../config/runtime-generation.json) and bootstrap
use the dealer profile. Two genuine nodes do not establish dealerless operation or
independent operators. A comparison is possible within the existing version.

Arcium describes Cerberus as detecting faults and aborting under its stated honesty
assumption. Confidentiality/integrity assumptions are distinct from progress when a
node is unavailable. [MPC protocol documentation](https://docs.arcium.com/multi-party-execution-environments-mxes/mpc-protocols).
Product status must show preprocessing mode, operators, recovery configuration and
availability separately; do not reduce them to a green “MPC connected” indicator.

## 6. Required product architecture

The following separation is a **proposal for evolving the existing code**, not a
request to rewrite its enforcement kernel or immediately introduce microservices.

| Boundary | Responsibility | What must not cross implicitly |
| --- | --- | --- |
| Customer project/toolchain | Original source, schema, tests, compilation, release and deployment identity. | Customer compilation cannot inherit a hosted operator's unrestricted filesystem/secrets. |
| Local owner client | Signing, confidential account keys, proofs, operation witness encryption and consent. | Account-wide keys and sensitive derivation material must not enter the hosted coordinator or analytics. |
| Policy/application control | Query admission, business identity, compatibility, scheduling, evidence and recovery. | Operator access cannot silently confer owner spending or unlimited policy-query authority. |
| Solana/Arcium enforcement | Native validation, computation authenticity, state version, exact settlement and consumer effect. | A UI flag or server database must never replace onchain authorization. |
| Application fulfillment | Verify paid effect and grant the intended service/access. | A receipt notification alone cannot establish payment or cause duplicate fulfillment. |

### 6.1 A durable, versioned operation contract

One business request should retain a stable identity across preparation, query,
settlement and fulfillment. Proposed conceptual fields include application/project,
environment/release, buyer, seller terms, asset/source/destination, consumer schema,
intent digest, preparation identities, approval attempts and observation history.
This is not an existing public wire schema.

Requirements:

- Separate business identity, immutable operation identity and transaction-attempt
  identity. Reject reuse of an idempotency key with different terms.
- Retain approval intent before signing and signed bytes before submission. Preserve
  exact original messages through recovery; fresh consent creates a distinct attempt.
- Keep query outcome, payment/effect, delivery and current entitlement usability
  separately typed. Never map a missing receipt to “unpaid.”
- Retain supported version decoders, observation floors and durable evidence through
  upgrades, storage migration and workspace restoration.
- Define idempotency scope and retention explicitly. Local Console deduplication
  does not yet provide an application-wide or multi-device purchase registry.

Solana explicitly documents that RPC acceptance does not establish confirmation.
[sendTransaction contract](https://solana.com/docs/rpc/http/sendtransaction).
Expiry must use the transaction's validity information and chain state, not a UI timer.
[Confirmation guide](https://solana.com/developers/cookbook/transactions/confirmation).
Durable nonces would be a new transaction profile, not an incidental retry fix.

As a design reference, Stripe stores results under idempotency keys, checks parameter
consistency and specifies retention behavior. We should similarly state our contract
without importing its semantics blindly or adding Stripe as a dependency.
[Idempotent requests](https://docs.stripe.com/api/idempotent_requests).

### 6.2 A policy package a developer can actually own

The project needs portable imports, public API exports, a compatibility manifest,
documented errors, test results bound to source/release, and deployment records that
survive moving a directory. It needs explicit states for edited, tested, built,
deploying, partially deployed and ready. A build is not automatically a policy test.

Maintain separate versions for authoring API, policy ABI/schema, native adapter,
SDK API, instance/journal storage and toolchain artifacts. Published entrypoints are
supported by [the pinned Node package model](https://nodejs.org/download/release/v24.12.0/docs/api/packages.html);
locked installation should fail rather than silently resolve different dependencies,
as [npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci/) specifies.

Usability needs include understandable arithmetic errors, synthetic test-state
fixtures clearly labeled as observer disclosures, cost/size estimates with units,
and a stable path from a customer rule to its deployed identity. Do not promise
arbitrary confidential Rust: document the current typed language and its limits.

### 6.3 An authenticated consumer and commercial-terms contract

Our merchant/license effects prove paid onchain state, but a useful integration also
needs authoritative terms. Proposed terms include seller/recipient, asset, amount
semantics, product/action, expiration, quote identity and the designated consumer.
Specify who authenticates them and bind them before the owner approves payment.

For a new consumer, define a reviewed interface containing:

- Canonical action encoding and digest, supported account roles and privileges.
- Settlement invocation and exact postcondition written atomically with payment.
- An observer that independently decodes and recognizes that bound effect.
- Failure/rollback, replay, stale-state, upgrade and entitlement lifecycle behavior.

Do not start with arbitrary unreviewed consumer plugins. First extract an explicit
contract from the two existing consumers, then qualify one genuinely new consumer
without editing the enforcement core if that is the selected extension design.

For offchain delivery, use a durable fulfillment record and authenticated buyer
access. Payment and the onchain entitlement can be atomic; serving a download/API
response cannot join that Solana transaction. Define retries and compensation for
delivery failure, and separate refund from simply retrying fulfillment. Event delivery
must tolerate duplicates and out-of-order arrival, as mature payment APIs explicitly
do. [Stripe webhook behavior](https://docs.stripe.com/webhooks).

**Privacy consequence:** a public product ID with a known fixed price can reveal an
amount by inference even when the transfer amount is encrypted. Decide which business
terms may be public, private or selectively disclosed; cryptography does not hide
facts the application reveals elsewhere.

## 7. Key custody, wallet support and team authority

### 7.1 Treat four kinds of authority separately

| Capability | Current boundary | Required product contract |
| --- | --- | --- |
| Owner transaction signing | Explicit local owner keyfile. | Validate exact approved message/signers; support rejection, partial approvals and expiry without substitution. |
| Account proof/decryption access | Local random ElGamal/AES keys and proof client. | A client-side proof provider, secure backup/restore and account/public-key correspondence. |
| Query administration | Local administrator co-signing. | Explicit policy-query authority, disclosure limits, revocation and auditable consent. |
| Deployment/runtime administration | Program/MXE authorities, runtime identities and shares. | Scoped operational roles, backup/rotation/migration procedures and emergency responsibilities. |

Wallet Standard permits `signTransaction` implementations to return a different
message, including for program/multisig wallet flows. A standards-compliant wallet
is therefore not automatically compatible with CyperLink's immutable transaction.
Validate the returned approved message and signatures; otherwise reject the unsupported
capability. [Wallet Standard source](https://raw.githubusercontent.com/anza-xyz/wallet-standard/master/packages/core/features/src/signTransaction.ts).

Confidential key recovery is separate again. Current Solana documentation describes
wallet-signature-derived confidential keys, while CyperLink retains independently
generated keys. A derivation flow is sensitive key access, not an ordinary login
signature. It would need dedicated wallet compatibility and migration qualification;
it cannot recover our existing random keys by assumption.
[Confidential account guide](https://solana.com/docs/tokens/extensions/confidential-transfer/create-token-account).

**Recommended first interfaces:** a transaction signer and a confidential proof
provider, initially backed by the current local implementation. Return only the
operation-specific proof/encrypted witness required for execution. Do not pass
account-wide keys to a remote service to make its API simpler. Then qualify one
concrete wallet/custody integration; “works with Solana wallets” is too broad.

### 7.2 Team access is not a shared local cookie

Before a team service, define project membership, environment isolation, owner/admin/
deployer/observer roles, approval separation, service identity, audit access and account
offboarding. A project administrator should not automatically gain spending or
decryption authority. Authentication to a dashboard and authority to sign an onchain
instruction must stay distinct.

Test owner and administrator in separate local processes first. Qualification should
cover unavailable approvers, mixed accounts, message changes, partial signatures,
expiry and recovery. General program-wallet or multisig support requires a new supported
profile; the current native owner profile excludes it.

### 7.3 Backup and exit must be usable features

Inventory separately the owner signing key, native ElGamal/AES material, project
release, operation journals, runtime node secrets/shares and recovery material.
Specify who backs up each, encryption/access rules, what can be reconstructed from
chain data and what loss is irreversible. Arcium's
[node operations guide](https://docs.arcium.com/developers/node-setup) makes persistent
identity/private-share storage material to runtime operation.

A backup test must restore the original account keys and generate a fresh valid native
proof, not merely recover a receipt. A runtime restore must execute a new authentic
computation, not merely start containers. A customer exit should preserve evidence
and account access without requiring CyperLink's hosted service to remain online;
the exact achievable exit guarantee must be stated per profile.

## 8. Query authorization and bounded autonomous permissions

Complete native admission prevents malformed native inputs from reaching private
evaluation. It does not make every valid funded query harmless: allow/deny results
can reveal information about shared state even when no payment follows.

The proposed query contract should specify subject, policy/state domain, authorized
operation, disclosure, validity window, query budget, nonce allocation, revocation
and audit retention. Charge/limit query work independently of settlement where needed;
otherwise denied or abandoned queries still consume compute without an operational
accounting model. A fresh computation must remain visible as a new disclosure action.

For human-approved spending, retain explicit owner/admin authorization. Avoid automatic
recomputation after a stale result unless the user approved a precisely bounded new
authorization model. A smoother UI must not quietly convert consent into delegation.

For autonomous spending, the following is a **future capability contract**:

| Dimension | Decision that must be explicit |
| --- | --- |
| Spending authority | Which escrow/PDA/account can an executor debit with a fresh transaction, without possessing the owner's key? |
| Scope | Asset, source, recipients/consumers, allowed action types, amount/rate limits and permission version. |
| Private proof access | Who can create fresh native proofs and how little decryption capability the executor receives. |
| Query permission | Which private decisions may be requested, at what rate/budget, and with what disclosure. |
| Expiry | Authoritative clock/slot semantics; distinguish permission expiry, query TTL and signed-transaction expiry. |
| Revocation | Who can revoke; whether it invalidates already admitted unconsumed permits; race ordering at settlement. |
| Recovery | Owner refund/exit, lost executor, key loss, pending work and remaining encrypted balances. |
| Accounting | Which quantity limits consumption: gross debit, net purchase amount, fee or a combination. |

The archived escrow experiment is evidence for its narrow native authority model.
It is not evidence for the combined private-policy system above. Replaying an
owner-signed transaction or operating a bot with the owner's key does not qualify.
Ordinary token delegation and Squads limits are useful authority precedents, but
neither proves compatibility with our pinned confidential instruction/profile.

## 9. Runtime, reliability and operating requirements

### 9.1 A reconciled local project lifecycle

The immediate product needs one supported lifecycle for inspecting prerequisites,
creating a project, starting/stopping/resuming its environment, testing/building,
deploying, connecting Console and retiring resources. Preserve existing identities
and ledgers by default. Never repair a partial environment by silently recreating it.

Reconciliation must compare intended versus observed state for each completed phase:
generated identities, deployed programs, MXE setup, circuit definitions, initialized
state, native assets, proof contexts, PreparedActions and published plans. Retain failure
logs and bounded safe actions. Process cancellation does not undo onchain work.

The reference currently lacks supported whole-stack resume and general deployment/
preparation recovery. Fix those before presenting deployment as a convenient browser
button. Qualify clean installation separately from running with the current host caches.

### 9.2 Explicit liveness and failure states

Arcium documents queued-computation expiry and different fee handling for expired
versus failed execution. Product timeouts must reflect the actual configured/runtime
contract, not a guessed duration. [Queue and fault handling](https://docs.arcium.com/computations/queue-ordering-and-fault-handling).

Expose actionable distinctions among awaiting approval, preparing, queued, executing,
allowed, denied, stale, expired, cancelled, failed and unknown, while retaining the
independent delivery/effect facts. No callback can mean several things; it must not
automatically trigger another query or payment.

A shared private state is a serialization boundary. Measure contention and stale
work before designing reservations or sharding. Those mechanisms change policy/state
semantics and are not required just to provide an honest first local product.

### 9.3 Observability without collecting the secrets

Proposed telemetry should cover operation stage durations, queue depth, error category,
RPC availability, callback age, version conflicts, retained storage and recoverable
rent. Record provenance sufficient to diagnose an operation, with access controls.

Do not put account keys, derivation signatures, plaintext private state, operation
openings or raw sensitive request bodies into hosted logs/analytics. Keep synthetic
observer disclosures explicitly labeled. Address/product/timing data can also be
sensitive; define collection and retention instead of treating all public chain data
as harmless when linked to customer identity.

For a managed service, assign incident ownership for the UI/API, RPC, runtime nodes,
upstream programs and application fulfillment. Define backup recovery point/time goals
and service targets only after measuring recovery and dependency behavior. No present
data supports a production SLA.

## 10. Security and release qualification

Preserve the existing enforcement invariants and review their composition: native
proof/account/funding admission before disclosure; owner/query authority; immutable
action/consumer binding; unique nonces/permits; callback authenticity; state version;
atomic effects; and original-transaction recovery. An audit of an upstream primitive
does not audit CyperLink's bridge, language wrapper, storage or UI consent.

Use a release manifest tying reviewed source, locked dependencies, compiler/circuit
artifacts, SDK bindings, tests and actual loaded ELFs together. Package provenance is
useful supply-chain evidence, not evidence of program correctness.
[npm provenance](https://docs.npmjs.com/generating-provenance-statements/),
[SLSA v1.2](https://slsa.dev/spec/v1.2/).

The final [NIST SSDF 1.1](https://csrc.nist.gov/pubs/sp/800/218/final) provides a
baseline for secure development and vulnerability-response practices. Apply its
principles proportionately: protected releases, dependency/license inventory,
reproducible builds, review, issue reporting and response. Do not claim a certification
or supply-chain level merely because a manifest exists.

| Test/evidence layer | What it should establish | What it cannot establish alone |
| --- | --- | --- |
| Host tests | Policy semantics, encodings, state machines, storage and errors. | Native execution, genuine callbacks or production privacy. |
| Local SVM/simulation | Program branches and bounded transaction behavior. | Distributed execution or a landed real-validator result. |
| Real local validator | Native verification, signatures, settlement, rollback and loaded bytes. | Public-network compatibility or independent operation. |
| Real distributed runtime | Actual encrypted input/output and authenticated callback through the chosen profile. | Independent operators, dealerless setup or availability under loss. |
| Restart/restore qualification | Same identities, preserved state and fresh work after interruption. | Recovery after every disaster or arbitrary key loss. |
| Public-network qualification | Exact deployment/asset/runtime profile on that network. | A production security audit or all-asset support. |
| Independent review | Scoped analysis of code, cryptographic composition and trust boundaries. | Absence of all future failures or safe later changes. |

Maintain negative-case coverage alongside happy paths: altered terms, unsupported
assets, invalid authority, state drift, callback mismatch, rollback, duplicates and
unavailable observations. Preserve raw archives and failed attempts with a documented
retention/restore process. The archive-location gaps in the implementation assessment
make evidence retention a concrete operational requirement.

## 11. Legal, compliance and privacy operating model

These are research findings and questions for qualified counsel, not a legal opinion
about CyperLink. Entity, jurisdictions, customers and exact service responsibilities
are not specified. A developer's timezone does not establish company jurisdiction.

Assess three models separately: self-hosted software distribution, managed policy/
approval coordination, and delegated escrow execution. Map who can sign, spend,
refuse execution, upgrade programs, recover funds and inspect information.

MiCA distinguishes non-custodial wallet software providers from regulated services,
but also defines transfers performed on behalf of clients. Its trading-platform
anonymisation rule is not a general ban on privacy software. Client-held decryption
keys alone do not settle the legal role of a managed operator.
[MiCA, recital 83 and Articles 3/76](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32023R1114).

AMLR Article 79 restricts certain anonymous or obfuscating accounts maintained by
specified financial institutions and crypto-asset service providers. Its general
application begins **10 July 2027** under Article 90. This is a material planning
issue for regulated customers, not a present blanket ban on private wallets or tools.
An auditor key does not automatically establish compliance.
[AMLR](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32024R1624).

FinCEN's 2019 guidance distinguishes supplying software from accepting/transmitting
value through a service. It is a federal BSA reference, not clearance under all US
laws. Counsel must evaluate actual operations and any applicable newer rules.
[FIN-2019-G001](https://www.fincen.gov/system/files/2019-05/FinCEN%20Guidance%20CVC%20FINAL%20508.pdf).

For any managed model, allocate customer eligibility, sanctions decisions, required
records and escalation to explicit responsible operators. OFAC's guidance uses
risk-based controls; it does not mean every software developer has identical service
obligations. [OFAC virtual-currency guidance](https://ofac.treasury.gov/media/913571/download).
Where GDPR applies, map data purposes, roles, minimization, retention and protection
by design; encrypted wallet-linked telemetry is not automatically anonymous.
[GDPR Articles 5/25](https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:32016R0679).

The product should support authorized, operation-scoped evidence without exporting
account-wide secrets. Decide who may see which amount, action and approval and why.
Revoking future access cannot erase information already disclosed. Any regulatory
attestation input must have a defined issuer, validity, revocation and binding model;
do not call a Boolean policy result “compliance” without that contract.

## 12. Business model, economics and capability needs

### 12.1 What someone might pay for

**Commercial hypothesis:** publish an inspectable enforcement/SDK foundation and
charge for maintained deployment/operation support, supported integrations, managed
coordination and service commitments. Choose licensing/distribution terms before
publishing packages; there is no top-level distribution license in the assessed tree.

Candidate recurring value is compatibility maintenance, reliable operation processing,
recovery, supported custody adapters, private-policy lifecycle and auditable evidence.
None automatically yields recurring revenue. One counterexample to assuming a
“privacy premium” is Request's early-access pricing: no separate private onchain
payment charge, with a 0.1% partner fee for USDT payments and other service charges separate.
[Request fee schedule](https://help.request.finance/en/articles/15007542-what-are-the-fees-for-using-the-request-business-account).
This is an adjacent pricing signal, not a CyperLink price benchmark.

Do not invent a market size or price from stablecoin transaction volume. Estimate
the reachable market from qualified teams that need this particular boundary,
their current engineering/support expense and procurement constraints. Compare an
integration/support model with usage pricing only after observing both cost and value.

### 12.2 Measure the full operation cost

Track these independently: installation/build effort; program/circuit deployment;
native account and proof preparation; query admission; MPC/runtime processing;
callback; settlement; failed/stale/abandoned work; RPC/storage/retention; support;
and reclaimable versus permanently retained rent.

The [current cost evidence](PRODUCT-ANALYSIS.md#8-costs-performance-and-operating-model)
is selected synthetic local receipts, not a public price or gross-margin model.
The approximately 19–20 second historical query-to-observation timings are not pure
MPC latency. Measure median/tail latency by phase and successful business effect,
including approvals and recovery. Record support time and failure-induced rework.

If billing for queries or failed work, explain that before authorization and impose
customer budget limits. Count business operations separately from native transactions
and compute attempts. A “successful payment” fee must not obscure who pays for denied
queries, deployment or abandoned preparation.

### 12.3 Capabilities the team needs

| Capability | Immediate responsibility | Later requirement |
| --- | --- | --- |
| Solana/protocol engineering | Preserve adapter, authority and atomicity invariants. | Asset profiles, consumer ABI, public deployment and migration. |
| Privacy/cryptography expertise | Review typed compiler/native binding and disclosures. | New authenticated inputs, preprocessing and delegated proof models. |
| SDK/developer experience | Portable project, typed lifecycle, signer/proof interfaces. | Stable distribution, language bindings and support tooling. |
| Systems/reliability engineering | Reconciled runtime restart, durable phases, archives. | Managed service operations, restoration and capacity. |
| Product/application engineering | Actual paid access and understandable consent/recovery. | Team workflows, fulfillment and integration support. |
| Commercial/legal support | Define target job, operating model and distribution terms. | Procurement, contracts, counsel review and customer-specific obligations. |

These are responsibilities, not a headcount or hiring forecast. Assign an accountable
owner to each gate even if one person initially covers several. Independent review
should remain independent of the implementation claims it evaluates.

## 13. Research-backed implementation sequence

The gates below are proposals. Keep the existing reference and pins unchanged while
probing new profiles in isolated environments.

| Gate | Deliverable | Acceptance evidence |
| --- | --- | --- |
| G1: Operable local runtime | Readiness, safe stop/resume and preserved identity. | Same ledger/genesis, runtime identities, ten ELFs and application state; retained share/preprocessing availability; keyless recovery and explicitly approved fresh execution after restart. |
| G2: Recoverable project | Portable package, test-bound release and deployment/preparation reconciliation. | Cold-host run separately from cached-host run; moved directory; interruption at each material publication/onchain phase without silent regeneration. |
| G3: Complete application | Authoritative terms and actual paid access using two different original policies. | Compatible purchases, stale rejection/fresh consent, denial, rollback, service restart and duplicate notification without duplicate effect. |
| G4: Independent authority | Signer/proof-provider boundaries and one concrete external signer integration. | Separate owner/admin processes, changed-message rejection, key backup/restore with fresh proof, expiry and exact-wire recovery. |
| G5: Team operations | Roles, isolation, retention, diagnostics, incident and exit workflows. | Cross-project access checks, restore exercise, readable old journals and documented support ownership. |
| G6: Named deployment profile | Real asset and public runtime compatibility, reviewed trust/authority model. | Read-only inventory followed by separately authorized execution; actual loaded bytes, fees/hooks, issuer/recipient readiness and independent review. |
| G7: Integrated permissions | Fresh delegated spending plus bounded private-proof/query authority. | No owner key in executor; expiry/revocation races; encrypted-balance recovery; repeated operations and negative cases in isolated real execution. |

G1–G3 define a useful local developer product. G4/G5 define substantial additional
team readiness. G6 is a production-path gate, not permission to deploy. G7 can be
researched in isolation without blocking human-approved usability; its production
offering depends on the relevant custody, team and asset gates.

### Smallest useful next experiment: retained whole-stack continuity

Use a new local environment with the current pinned versions and trusted-dealer
profile. Complete one genuine paid operation, then stop Console, validator and
Arcium. Resume the same ledger, node secrets/shares, trusted-dealer identity/master
seed, preprocessing state and deployment. Verify genesis, loaded ELFs, retained
operation bytes and tracked application state. Recover payment
without new owner/admin signing, simulation or submission. Finally, explicitly
authorize a fresh operation and require a new authentic callback and paid effect.

This tests a capability the product currently lacks, needs no public-network write,
and creates the lifecycle foundation for every later feature. Startup must reject
identity mismatch and conflicting processes, not reset the environment. Runtime-node
signing during resumed execution is distinct from automatic owner approval.
Retaining runtime identity/material does not mean requiring every preprocessing or
share file to remain byte-identical after fresh execution legitimately advances it.

### Follow-on probes with decisions they resolve

| Probe | Decision resolved | Pass/fail criterion |
| --- | --- | --- |
| Pinned upstream resume primitives | Reuse upstream or implement missing phase reconciliation? | Prove actual 0.15.0 behavior against retained identities; no inferred support from unversioned docs alone. |
| Portable customer project | Can a developer own the application outside this checkout? | Move/reinstall project, resolve versioned SDK, observe retained payment and author another rule without core edits. |
| Proof-key restoration | Is customer money operable after local state loss? | Restore synthetic account keys and generate a new valid proof; receipt-only recovery does not pass. |
| Real paid service | Does the operation deliver customer value beyond a receipt? | Authorized terms, one payment, authenticated access, restart/replay without double fulfillment. |
| Distributed preprocessing | What trust/capacity change occurs without a version upgrade? | Isolated real execution and restart, explicit persistent material, resource/latency evidence; no change to reference claims. |
| Hash-addressed circuit delivery | Can deployment burden fall without weakening identity? | Exact loaded circuit hash, failure on unavailable/wrong content, measured upload/rent difference; local storage experiment first. |
| One fee-aware asset profile | Is an identified customer's asset actually supportable? | Correct gross/net/fee semantics and lifecycle, including zero-bps extension and schedule transitions. |
| Equivalent upstream application | Is CyperLink reducing meaningful customer work? | Same guarantees and task, tracked expertise/assistance/recovery; unfinished dimensions remain inconclusive. |

## 14. Decisions to keep explicit

The next local work does not need credentials or production keys. Later milestones
will need decisions about the first actual customer's workflow/asset, signer/proof
integration, allowed consumer extension model, who operates admission/runtime, supported
platforms, distribution license, jurisdiction and service commitments. Record these
when they become dependencies instead of making them implicit implementation defaults.

Do not add cross-MXE composition, a new cryptographic system, arbitrary assets, a
treasury dashboard, universal wallets or a hosted compiler as requirements for G1–G3.
Do not remove exact payment binding or owner key custody to reach an easier demo.

The main commercial uncertainty remains whether a team needs this specific boundary
enough to integrate and pay for it. The main near-term engineering uncertainty is
whether the complete project—not just a retained transaction—can be operated and
recovered independently. The recommended sequence addresses the latter while making
the former testable with a real usable product.
