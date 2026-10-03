# Explicit approval sessions and controlled direct-client comparison

Started 2026-10-03. Preserve the paid-license reference at commit
`cce20f35c21f048972ca065221f1693b63e00fbd` and its v21b archives. No policy,
native program, circuit or qualified trust-profile change is planned.

1. Add an opt-in SDK session with explicit owner and administrator signing inputs;
   observation and recovery open without keys. Reserve a durable descriptor/role
   approval slot before signing and discover its original transaction after a
   staging-to-ticket-save crash. Never resolve ambiguity by signing again.
2. Exercise the same private-cap license operation in a separate sample. Kill real
   processes before signed-wire persistence, after persistence but before simulation,
   and after simulation but before ticket publication. Reconcile in fresh keyless
   processes; explicit resubmission must use the identical signed bytes. Qualify
   actual local Arcium callbacks and paid effects, retaining failed attempts.
3. Implement a controlled direct client with pinned web3/Anchor/Arcium and native
   proof tooling. Share the reviewed deployed policy/enforcement programs and
   provisioning harness, disclose that reuse, and compare concrete client code,
   required protocol knowledge and tested failure handling. This is not an
   independently implemented enforcement stack. Any missing parity leaves the
   corresponding comparison inconclusive, with no productivity/advantage claim.

Host tests, validator transactions, two-node local computation and offline archive
checks will be reported separately. Raw keys, signed-wire journals and experiments
remain under ignored `.local/`. No public-network actions are in scope.

## Session result: qualified

The additive [application](../examples/license-session/README.md) now uses generated
`connectSession` bindings. Owner and administrator keyfiles are explicit inputs to
preparation/staging; opening, loading, observation and recovery require neither.
The legacy `connect` API and original application are preserved. SDK changes do
not change the policy release identity or deployed programs/circuits.

[Real local qualification](../evidence/2026-10-03/license-session-v22b.json) passed
with two authenticated decisions and paid licenses. Query and payment each survived
two SIGKILL points: signed-record persisted before simulation, and simulation
persisted before ticket publication. New keyless processes found the original
transaction, verified its exact instruction/signatures/ledger, performed read-only
reconciliation, and then explicitly submitted identical bytes. No new key, query,
nonce, blockhash or signature was substituted. Read-only recovery left48 tracked
account observations unchanged and made no broadcasts. A fifth SIGKILL before
signed-record publication caused both recovery and repeated approval to refuse
restaging. The sender may already have signed in memory at that boundary.

[Independent archive review](../evidence/2026-10-03/license-session-v22b-offline-review.json)
verified6 signed messages/10 Ed25519 signatures,4 recovered tickets,2 callbacks,
2 complete native/state/license transitions,10 loaded ELF reports and2 complete
uploaded circuits/interfaces. [Ten corruption checks](../evidence/2026-10-03/license-session-v22b-corruptions.json)
rejected missing or altered evidence. These are offline checks of retained local
RPC/runner observations, not historical consensus proofs, OS attestations or an
independent BLS implementation.

The first run exposed a harness expiry1500 error: the consumer permits a maximum
1000-slot horizon. Its query recovered and authorized, then payment simulation
rejected1101 without settlement. The failed archive remains intact. The successful
v22b run used a new operation/output directory, expiry900, and the same still-unspent
business state at version0/counter2. It ended at version2/counter4. Initial
allowance50/cap30, purchases10/20 and inferred remaining20 are test-observer
synthetic disclosures. This is not a fresh initial-counter1 claim.

Validation:46 combined policy SDK/CLI host tests,46 local-client/reference-app
regression tests,18 of those SDK tests specifically covering store/session failure
handling, and strict TypeScript compilation of generated `connectSession` bindings.
The original v21b archive was independently reverified after these changes, retaining
its original SHA256 and all15 messages/25 signatures/5 callbacks/2 paid licenses.

Reproduce against a fresh instance with the unchanged license policy:

```sh
node packages/policy-cli/cyperlink.mjs policy build examples/license-app
node examples/license-session/qualify.mjs .local/INSTANCE/instance.json .local/NEW-QUALIFICATION
node examples/license-session/verify.mjs \
  --results .local/NEW-QUALIFICATION/results.json --instance .local/INSTANCE/instance.json \
  --output .local/NEW-QUALIFICATION/offline-review.json \
  --corruption-output .local/NEW-QUALIFICATION/offline-corruptions.json
```

Raw completed instance: `.local/license-session-instance-v22/`. Archives:
`.local/license-session-qualification-v22{,b}/`. They share v21's existing RPC8985
ledger and two-node runtime, without resetting any reference evidence. Arbitrary
provisioning interruption and independent-machine reproduction remain unqualified.
The direct-client comparison is still in progress; no equivalent-completion or
comparative advantage claim follows from the completed session work.
