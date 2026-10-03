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
