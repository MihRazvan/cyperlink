# License operation versus direct pinned upstream APIs

Historical source/API review. The subsequent [controlled executable client comparison](license-client-comparison.md) records actual runs, shared enforcement, remaining parity gaps and implementation work. The [session milestone](license-session-milestone.md) addresses the signer/journal friction identified below.

Source review dated 2026-10-03. A direct Arcium + Anchor + native Token-2022
implementation is a credible alternative. Those dependencies already provide
the cryptography, computation plumbing, callback authentication, transaction
delivery and account reads used here. CyperLink supplies a particular composition:
bind a private decision to one funded native action, consume shared private state
only with payment, issue the exact license atomically, and reconcile that operation
after a client restart. This review does not establish a measured implementation
cost, performance advantage, or a separately implemented direct baseline.

The operation being compared is [this application's policy](../examples/license-app/policy.rs):
accept a positive native payment only if it fits both private `purchase_cap` and
private `remaining`; decrease remaining on successful settlement, preserve the cap,
and grant the chosen buyer/product/absolute-expiry license. Native account
decryption keys remain client-side. Query authorization and payment authorization
are separate explicit approvals. An allowed query is not a reservation. The
[license consumer](../programs/custom-policy/native/license/src/lib.rs) also checks
its exact buyer/product PDA and a validity window of at most 1000 slots at commit.

## What is already upstream

The JavaScript versions are pinned in [package.json](../config/local-js/package.json)
and [package-lock.json](../config/local-js/package-lock.json): Arcium client 0.15.0,
Anchor JS 1.2.0, web3.js 1.99.0. Rust Arcium 0.15.0 and native SDK 7.0.1 are
recorded in the [auth lock](../programs/custom-policy/auth/Cargo.lock) and
[proof-client lock](../crates/client-proofs/Cargo.lock). Anchor Rust/IDL tooling
has its separate 1.0.2 pin; it is not JS 1.2.0.

| Concern | Direct upstream capability inspected | Work for this exact operation |
| --- | --- | --- |
| MPC input encryption and MXE keys | Arcium JS exports `getMXEPublicKey`, X25519, `CSplRescueCipher`, `RescueCipher`, packers and MXE/computation PDA helpers. | Choose the correct cipher domain and encrypt the same amount/opening as the native proofs. Preserve nonce uniqueness and authoritative state selection. CyperLink uses the scalar-field CSpl path; the base-field Rescue cipher is not an interchangeable substitute. |
| Native account keys and proofs | SDK 7.0.1 supplies ElGamal key generation/serialization, authenticated encryption, Pedersen operations and equality/grouped/range proofs. Native proof instructions and Token-2022 execute their own checks. | Persist the keys privately, provision verified proof contexts and retain the transfer opening needed for the MPC bridge. Key retention and native ZK proofs are upstream capabilities, not CyperLink cryptographic inventions. |
| Computation setup and queueing | Arcium supplies circuit upload/MXE setup helpers, `ArgBuilder`, `queue_computation` and queue-account macros. | Define the policy circuit, application accounts, signer permissions and exact input snapshot; bind the queue to those accounts and a unique operation. |
| Authentic callback results | Arcium's callback macro injects `validate_callback_ixs`; `SignedComputationOutputs::verify_output` verifies the cluster BLS signature, including computation slot/counter binding. | Call the verification helper, retain its account constraints, then check that this authenticated result belongs to the intended Job, native commitment, quota version and consumer action. |
| Settlement and rollback | Solana transactions/CPI and native Token-2022 supply atomic execution and token proof enforcement. | Arrange the payment, shared-state transition and exact license write in one transaction; reject stale versions, substitution and reuse. CyperLink relies on runtime atomicity and implements these application checks. |
| Sending and observing | Anchor sends signed transactions and confirms them; web3 exposes raw retransmission, receipt/signature history and account reads. Arcium supplies computation-finalization polling. | Retain the operation and signed bytes durably and distinguish successful computation, successful transaction delivery, consumed authorization and the actual paid license effect. |

The native bridge deserves separate accounting. The
[proof-generation provenance](../crates/client-proofs/UPSTREAM.md) identifies the
recorded generator as 0.6.1 using SDK 7.0.1. Its research addition returns the
combined Pedersen opening while retaining upstream proof builders. Registry
proof-generation 0.5.1 uses a different SDK and is not an equivalent substitution.
A direct implementation can expose that opening in its own proof preparation;
it need not copy CyperLink's surrounding SDK, and should count that adaptation
explicitly rather than pretend an encrypted arbitrary amount proves a payment.

## Recovery APIs already exist

The inspected Arcium `awaitComputationFinalization` derives the computation PDA,
polls its account over HTTP every 500 ms, retries account-fetch errors until its
timeout, and, after seeing `finalized`, retries lookup of the latest transaction
signature. It defaults to `confirmed` commitment and a 120-second timeout. A
caller retaining the computation identity can invoke it again after restart;
there is no requirement to have observed a live WebSocket event. Its returned
latest signature is a useful computation observation, not a CyperLink payment
or exact license-effect check. These are source defaults, not measured latency.

Anchor JS 1.2.0's provider serializes the signed transaction and its internal
`sendAndConfirmRawTransaction` retries the same bytes on `TimeoutError` within a
60-second loop. It passes retry/preflight/minimum-slot options and supports a
blockhash-aware confirmation strategy. web3.js also exposes
`getSignatureStatuses` with history search, `getTransaction`, `sendRawTransaction`
and confirmation strategies. A direct app can use these primitives to build
restart-safe recovery. It would be inaccurate to claim upstream cannot resend
identical bytes or recover a missed callback.

The inspected helpers do not themselves save this application's operation
descriptor, owner/admin approval intent or signed-wire journal to durable storage,
or reconcile its quota/permit/license records. That is the narrower contribution
of [DurableTransactionSender](../packages/local-client/src/durable-transaction.mjs),
the [policy operation client](../packages/policy-client/src/operation-client.mjs)
and the [keyless recovery worker](../packages/policy-client/recover-operation.mjs).
They bind retained bytes to a validator genesis, operation descriptor and ticket
role, journal before sending, validate signed messages and compare chain effects.
An unresolved expired wire stays unresolved; recovery does not silently allocate
another nonce or refresh the blockhash. This is conventional durable client
engineering around upstream APIs, not a new consensus or cryptographic primitive.

Arcium's IDL additionally exposes MXE key-recovery accounts/instructions and
recovery-peer setup. Those concern runtime key recovery, which is a distinct
problem from recovering this application's signed query/payment after a lost
response. Their presence must not be counted as either missing upstream support
or a completed CyperLink account-key backup feature.

## SDK convenience and on-chain enforcement are different layers

The authoring CLI, generated bindings and operation client package provisioning,
typed policy inputs, encryption, proof preparation, instruction assembly and
retained operation files. A developer comfortable with Anchor and native APIs
could implement those steps directly. The observable ergonomics question is how
much application-specific code and source inspection remain necessary, not
whether upstream can create an instruction.

The security composition lives in the kernel and generated programs:

- [Auth](../programs/custom-policy/auth/programs/cyperlink_auth/src/lib.rs) retains
  the immutable PreparedAction and Job/PermitClaim, requires owner/admin query
  authorization and the signed quota snapshot/counter, validates native admission,
  allocates nonces, queues computation and admits only a matching authenticated
  result. [Native admission](../crates/native-admission/src/lib.rs) checks the
  supported proof/account/funding relationships before the private query.
- [Guard](../programs/custom-policy/native/guard/src/lib.rs) binds the native
  instruction, source prestate, owner and consumer action again at settlement.
  The [policy hook](../programs/custom-policy/native/policy/src/lib.rs) enforces
  quota version/digest comparison, exact armed permit and single consumption,
  advancing encrypted state during the native transfer.
- The [consumer ABI](../programs/custom-policy/native/interface/src/lib.rs) uses
  an action-derived consumer PDA signer. The license program computes the exact
  buyer/product/expiry/destination/mint digest, calls settlement, then writes the
  license. A later failure rolls back those writes and native settlement together.

A direct baseline needs equivalent enforcement somewhere, but need not reproduce
CyperLink's program count, layouts or names. For one app it could consolidate
logic in application programs and use upstream macros directly. It must still
prevent alternate token-spend paths from bypassing the chosen shared policy and
preserve owner authorization. Mint-hook authority, upgrade/circuit trust, explicit
query disclosure and the no-fee native profile remain assumptions of this design.
Neither generated bindings nor a successful callback eliminate those assumptions.

The [internal app's friction log](../examples/license-app/FRICTION.md) is adverse
evidence for a claim of a fully self-explanatory SDK. Its separate internal author
needed SDK source inspections to understand the payer/admin mapping, prepare's
implicit provisioned-owner loading, session reopening and recovery-worker output.
There is also a staging-to-ticket-save interruption gap: an approval-intent file
blocks accidental restaging, but automatic ticket rediscovery is not supplied.
This is internal integration experience, not external customer validation.

## A practical comparison still to run

1. Freeze the same pinned versions, synthetic no-fee mint/profile, private policy,
   explicit owner/admin approvals and exact buyer/product/expiry contract. Keep
   account keys client-side and all new identities, ledgers and measurements in
   ignored `.local/`. Give the direct author the upstream APIs and acceptance
   criteria; record any CyperLink implementation consulted.
2. Implement the direct client and application enforcement, retaining upstream
   cryptography, callback macros and output verification. Separate common setup
   work from application policy, native amount/opening adaptation, admission,
   atomic effect checks and durable recovery. Report source inspections and
   missing docs, including those already recorded for the CyperLink app.
3. Run both against fresh local validator/two-node runtimes. Check actual loaded
   ELFs against builds and uploaded circuits/interfaces before comparing results.
   Preserve host tests, local SVM, real validator and distributed results as
   separate evidence categories.
4. Exercise payment within cap; denial above cap with allowance/funding left;
   quota exhaustion; mismatched amount/commitment; wrong owner, destination,
   product and expiry; stale concurrent authorization; replay; unauthenticated
   callback; and a post-transfer consumer failure with unchanged before/after
   accounts. The license consumer's explicit post-settlement failure is 1199.
5. Lose the send response, stop the app, and use a separate process to observe
   and explicitly resend the retained signed bytes. Compare signatures, message
   bytes, blockhash, nonce and exact effect. Test unresolved expiry without
   automatic replacement. Credit upstream polling/retry helpers in both paths.
6. Only then record comparable implementation effort and maintenance surface,
   staged transaction/CU/fee counts, and separate proof/computation/callback/
   settlement/recovery latency. Do not infer savings from a small example file
   that delegates to a large SDK, or from shorter application code that omits the
   enforcement/recovery contract. No such comparative measurements are asserted
   here.

## Exact primary sources inspected

Installed JavaScript files are local ignored dependencies, not files shipped by
this document. The Cargo registry root on this host is
`/Users/razvan/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f` (`R` below).
On another host locate the same crate versions from the locks. The hashes below
identify the inspected source bytes; they are not an independent upstream audit.

| Local source | Inspected symbols | SHA-256 |
| --- | --- | --- |
| [Arcium client bundle](../.local/toolchain/js/node_modules/@arcium-hq/client/build/index.mjs) | `CSplRescueCipher` line1137, `getMXEPublicKey`24431, `awaitComputationFinalization`24792; exported IDL/recovery helpers | `a29c46f47aa8499bbdcc811602148f080332c343f73c7ec049c6d8fae5060579` |
| [Anchor provider](../.local/toolchain/js/node_modules/@anchor-lang/core/dist/cjs/provider.js) | `sendAndConfirm`75, `sendAndConfirmRawTransaction`263 | `710b983a8f59f38cec43f29581422502068871eb591c7dc3b4775945f0a4b687` |
| [web3 connection](../.local/toolchain/js/node_modules/@solana/web3.js/src/connection.ts) | `confirmTransaction`, `getSignatureStatuses`, `getTransaction`, `sendRawTransaction` | `9b02aa528fce1ef5429eafc5838ccf8f130decddf12023408bc61305c053a824` |
| `R/arcium-anchor-0.15.0/src/lib.rs` | `verify_output_raw`257, `verify_output`279, signature computation binding289, `queue_computation`332 | `2c3495e1874f104aec6bd03c6c8a935776eb106beb1bb081b3a7e7ca5e6233e3` |
| `R/arcium-macros-0.15.0/src/callback_macros.rs` | injected `validate_callback_ixs`373 | `be2508acb847ae90a5cbb60e2029e983eda75a750f241de88371901818096720` |
| `R/solana-zk-sdk-7.0.1/src/encryption/elgamal.rs` | `ElGamalKeypair::new_rand`, key read/write and encryption | `e8b800c12ed0b0d26ab01869a34abe01d997dbdb99ffc6932cf7d1a2e8cf4d0f` |

The same SDK's `src/encryption/{auth_encryption,pedersen}.rs` and
`src/zk_elgamal_proof_program/` supply native cryptographic primitives; the
[vendored transfer generator](../crates/client-proofs/vendor/proof-generation/src/transfer.rs)
and [source hashes](../crates/client-proofs/vendor/proof-generation/source-hashes.json)
identify the exact bridge input provenance. Reproduce the source check with
`shasum -a 256 <path>` and inspect the named functions; no network call, transaction
or installation is needed for this comparison.
