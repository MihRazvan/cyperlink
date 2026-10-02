# Customer-authored policy qualification

The customer package → compiled circuit → fresh deployment → real private decision
→ exact native payment/effect → recovery path passes on the bounded local profile.
See the [developer quickstart](custom-policy-authoring.md),
[safe run summary](../evidence/2026-10-02/custom-policies-v20b.json) and
[independent offline review](../evidence/2026-10-02/custom-policy-v20b-offline-review.json).

## What actually ran

`budget-count` and `minimum-reserve` are separate customer directories containing
original expressions and two-field private schemas. The second was authored by a
separate internal agent using the documented API after the authoring core existed;
no name-specific core branch was added. This is internal independent authoring,
not external customer adoption.

Both instances coexist on genesis `B7NXk9pQWhap2c9aZvfkwEiXcgv9DLyLecJnkKjTAusm`.
Each has five generated enforcement/application programs, its own genuinely
initialized MXE and encryption key, state identity and synthetic mint hook. Both
use the same two local Arcium operators. Ten distinct generated ELFs plus five
shared dependencies were compared against actual loaded bytes. Four uploaded
circuit artifacts and their registered interfaces were read and byte-checked.
Private state initialization and every policy evaluation used real runtime
callbacks, upstream native proofs and owner/admin signatures.

| Check | Actual evidence |
| --- | --- |
| Count rule | Synthetic initial remaining100/count4; merchant40 paid and advanced both private fields; fresh1 denied with funding remaining. |
| Private reserve | Synthetic private remaining100/reserve70; merchant40 denied; license20 paid. |
| Budget-only control | [Separate v19 legacy control](../evidence/2026-10-02/custom-policy-budget-control-v19.json) paid merchant40 and recovered its exact transaction, with ten matching ELFs. |
| Native input binding | Altered encrypted amount, opening and wrong cipher domain each produced an authenticated denial; no business-state advancement. |
| Query authority/isolation | Wrong source owner/admin6001, foreign state2004, MXE/definition2012, wrong native contexts/profile6000, wrong permit length6002, unauthorized init/reinit6001. |
| Callback authority | Direct replay9999 and wrong computation association6000 rejected. |
| Lifecycle | Allowed callbacks did not advance business state; expired permit830 and cancelled permit700 rejected. Counter-only drift rejected a retained owner/admin-signed query6004 before new MPC work. |
| Exact action/atomicity | Recipient/action/consumer changes705; forced consumer1099 after native CPI rolled back complete state, token balances, permit and entitlement. |
| Competition/replay | Winning merchant40 paid; competing license1 rejected stale803; replay1001; fresh1 denied by purchase count. |
| Cross-instance settlement | Foreign policy permit rejected700; successful commits left the other policy's state unchanged. |
| Recovery | Lost acknowledgement followed by separate keyless processes reconciled/retransmitted identical signed bytes; one paid effect, no hidden new query/signature. |

Initial values, amounts and resulting plaintext arithmetic above are explicitly
**synthetic test-observer disclosures/inferences**, not decryption of live MXE
state. Paid transitions independently match all four successor ciphertext slots
and nonce to the authenticated callback; untouched padding and identities remain
bound. No staged authorized permit, injected verified context or fixture-key
circuit participates.

Edited release/schema descriptors and arbitrary successor-content corruption are
covered by host SDK/layout/archive corruption checks. Those individual mutations
are not labeled as corresponding landed runtime attacks. The live matrix includes
wrong-length, cross-instance, callback-association, full-state rollback and stale
execution tests. Compilation is not a correctness/privacy certification for
arbitrary customer rules.

## Independent evidence review

The offline reviewer checked9,087 signed messages and9,283 Ed25519 signatures,
10 policy callbacks and2 initializer callbacks,22 landed rejections and319 unchanged
application-account comparisons. It checked2 exact paid effects,9 retained tickets,
4 recovery processes,15 loaded ELFs and4 actual uploaded circuit byte proofs.

This reviews retained confirmed RPC messages/account snapshots. It is not a
historical consensus-state proof. BLS authenticity rests on successful onchain
verification by the matched program/runtime; this is not a second offline BLS
implementation. No production-security or public-network claim is made.

Host checks:144 Node SDK/example/archive tests,8 CLI groups and82 Python tests
pass. Additional Rust compiler/layout/native/Auth tests remain described in
[compiler gate](compiler-gate.md) and the implementation sources.
Generated TypeScript bindings passed strict TypeScript5.9.3 NodeNext checking.

## Costs and timing

The safe review contains the complete deduplicated categorized validator table,
including failed-transaction fees. Selected totals for the two deployments and
qualification matrix:

| Category | Transactions | Solana CU | Local lamport fees |
| --- | ---: | ---: | ---: |
| Program upload/deployment | 2,038 | 4,834,560 | 10,290,000 |
| Circuit upload | 6,775 | 62,697,329 | 33,875,000 |
| Native asset provisioning | 38 | 153,924 | 340,000 |
| Proof/operation provisioning | 132 | 2,723,448 | 1,140,000 |
| Runtime callbacks, including initialization | 12 | 1,806,210 | 60,000 |
| Successful native settlement | 2 | 165,456 | 20,000 |

Queue, initialization, lookup tables, cancellation, application setup and
adversarial categories are separate in the JSON report. These are synthetic local
validator fees/CU, not production pricing. Rent, funding and distributed-runtime
resource costs are excluded. Uploaded setup is not per-purchase cost.

Repeat builds produced identical release/artifact hashes in14,447ms(count) and
12,463ms(reserve), on this host with caches and concurrent local services.
Modeled evaluation compiler weights were1,007,031,150 and961,180,764ACUs;
initialization was794,133,188 for each. ACUs are not Solana CU or measured latency.
Observed evaluation timing was19,032–20,377ms from **before query staging** to
callback observation, including ALT/finalization and RPC work. It does not isolate
MPC latency or establish a performance benchmark.

## Reproduce and preserve

Follow [authoring](custom-policy-authoring.md) to build/deploy fresh instances,
then run:

```sh
node examples/policies/qualify.mjs \
  --deployments .local/COUNT/instance.json,.local/RESERVE/instance.json \
  --out .local/NEW-qualification --scenario combined
node packages/policy-cli/collect-deployment-evidence.mjs \
  .local/COUNT/instance.json .local/COUNT/supplemental-deployment-receipts.json
node packages/policy-cli/collect-deployment-evidence.mjs \
  .local/RESERVE/instance.json .local/RESERVE/supplemental-deployment-receipts.json
node examples/policies/verify-qualification.mjs \
  --results .local/NEW-qualification/results.json \
  --instances .local/COUNT/instance.json,.local/RESERVE/instance.json \
  --out .local/NEW-qualification/offline-review.json
```

Use the documented synthetic count4/reserve70 initial values for this acceptance
harness. Business state must be untouched at its start. The CLI is general across
authored policies; this named acceptance harness tests these two examples.

Raw archives are `.local/custom-policies-v20-count2/`,
`.local/custom-policies-v20-reserve/`, `.local/custom-policy-qualification-v20b/`
and `.local/custom-policy-budget-control-v19/`. Secrets remain ignored and local.
The v20 ledger is `.local/localnet-custom-policies-v20/app/ledger`; RPC8983,
compose project `cyperlink-custom-policies-v20`. Validator PID45794 was verified
for this ledger. Verify process ownership again before stopping it. Do not reset
or delete the ledger. V18/v19 services are stopped and their evidence retained.

The existing Approvals UI exposes selected policy/release/schema/MXE and actual
allow/deny outcomes without initialization values or inferred remaining balances.
The [separate browser qualification](../evidence/2026-10-02/custom-policy-ui-v20-review.json)
passed desktop1440px and mobile390px visual checks without horizontal overflow,
prepared merchant5, obtained explicit query/final approvals, observed its real
allowed callback and paid entitlement, injected send-response loss, restarted the
server and recovered the identical payment through keyless process7571. Only one
query and one payment ticket exist. Four ciphertext slots committed at reserve
version2; a separate final bank read verified the count state entirely unchanged.

UI query/callback/payment used180,357/159,532/88,619 Solana CU respectively, with
10,000/5,000/10,000 local lamport fees. These exclude proof/setup/runtime-resource
costs and are separate from the earlier matrix totals. Browser session/raw receipts
are `.local/custom-policy-ui-reserve-v20/`; final images are
`browser/reserve-paid-desktop.png` and `browser/reserve-paid-public-mobile.png`. Server PID6705 serves
<http://127.0.0.1:4317>; the prior count UI and server PID93133 are stopped.
Restart using the same retained session after verifying/releasing its live process:

```sh
node examples/approvals/server.mjs \
  --bootstrap .local/custom-policies-v20-reserve/instance.json \
  --session .local/custom-policy-ui-reserve-v20 --port 4317
```

Verify process ownership before stopping either service. To stop this runtime's
containers without deleting evidence:

```sh
docker compose -p cyperlink-custom-policies-v20 \
  -f .local/localnet-custom-policies-v20/app/artifacts/compose.json stop
```


## Preserved failures and explicit limits

- V19 default Agave4.3.0 genesis rejected new SBPFv0 deployment. V20 explicitly
  uses `--allow-pinned-sbf-v0-deployment`, disabling only SIMD-0500 feature
  `B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g` at genesis. Preparation records
  the deviation. This is not default-cluster/public-network parity.
- First v20 deployment reused native binaries containing the preceding instance's
  addresses through a shared build cache; provisioning rejected834 before state
  initialization. Per-instance isolated build targets fixed this. Both final
  deployments have different configured ELF hashes and pass actual execution.
- First qualification attempt stopped before any payment because its callback
  negative incorrectly supplied an owner signature for a nonsigner account.
  The corrected v20b run retained the same untouched business states and their
  advanced admission counters; no state or nonce was reset. Both archives remain.
- Separate synthetic no-fee mints per hook; CPI Guard disabled; explicit owner/admin
  approval for each private query and owner approval for each settlement.
- Local trusted Cargo compilation, public source constants, approved Boolean
  disclosure and trusted upgrade/deployment authorities. Private initialization
  is not in the public manifest or UI. Arbitrary interrupted deployment recovery,
  state migration, same-mint multi-policy routing, fee assets/AUSD, independent
  operators, public deployment and autonomous grants are unqualified extensions.
