# Interactive Approvals qualification

The local client wraps `LocalOperationClient`; it does not replace native
verification, owner authorization, private-policy admission or atomic settlement.
The supported [initial profile](initial-profile.md) is unchanged. Public-network
execution, production security and a second-machine installation are unqualified.

## Compatible run

Fresh run `approvals-compatible-v16`, genesis
`9g7wsrHXtEY11RHqWJbEUsNqke3RemNm7aSrKgAeD77P`, used the genuine native proof
path, real local validator and two-node Arcium runtime. Browser clicks prepared
and approved the merchant and license through the actual SDK APIs. Both paid40;
final quota version2. Initial100, amounts40 and inferred remaining20 are
**synthetic test-observer disclosures**; the UI does not decrypt the MXE quota.

The merchant's final approval enabled the test fault that sends the real signed
transaction but hides its acknowledgement. The server stopped (PID59274) and
restarted (PID66094); explicit recovery spawned keyless worker66500, which found
the original signature committed. The worker did not create a new signature,
blockhash or policy query. These PIDs and browser actions are operator-observed
test evidence, not OS attestations. The signed journal and independent chain
review bind the recovered payment to the exact retained bytes.

The independent session review checks ten current loaded ELFs, four exact signed
query/commit transactions, immutable PreparedAction binding, both matching paid
effects and the retained recovery result. It performs only loopback account and
receipt reads, and loads no signing keys. Confirmed RPC observations are not
historical consensus proofs or independent BLS verification. Callback receipt
costs are reviewed separately; settlement totals exclude native proof setup,
provisioning, uploads and distributed worker costs.

The [desktop capture](assets/approvals-local-desktop.png) and
[mobile public projection](assets/approvals-local-mobile-public.png) show actual
paid state from this run. The390px mobile view has no horizontal overflow. The
public projection omits amounts and controls; it is not an authentication
boundary. Public identities, timing and policy decisions remain visible. A paid
license's issuance record persists after its displayed access expiry.

## Conflict run

Fresh browser/runtime qualification is in progress. The completed SDK baseline
already independently qualifies native stale803, fresh denial and adversarial
rollback in conflict-v15; do not mistake that older evidence for new UI execution.

## Reproduction and continuation

Follow [the interactive guide](../examples/approvals/README.md). Bootstrap once
per fresh ledger; reuse the same session only for observation/recovery. Do not
reset a partial run or regenerate a signed operation. Only one validator may own
faucet9900. The same-session server lock is fail closed; see
[crash reconciliation](../examples/approvals/SESSION-LOCK.md).

Private raw artifacts remain in `.local/approvals-compatible-v16` and
`.local/approvals-ui-compatible-v16`; no account keys or private proofs are
published. The first UI process predated the later session-lock and interrupted
commit-discovery hardening; those changes have separate host regression tests.
The on-chain programs and circuits did not change, and actual loaded bytes were
checked before signing and independently after execution.

Remaining usability work includes wallet/KMS adapters, full interrupted native
provisioning recovery and lifecycle cleanup. Arbitrary preparation interruption
is not handled by silently recreating proofs or nonces. The scoped Permissions
experiment is [a separate authority and disclosure profile](permissions-feasibility.md),
not a newly supported Approvals mode.
