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

Fresh run `approvals-conflict-v18`, genesis
`58EeUuFfAX3C7H688McxTqSkeXGEcmxTbSpMqbLE5uU4`, passed through the browser.
Both60 requests were authorized before merchant A paid. License B became stale;
a direct stale commit request returned HTTP400 with no new signed ticket. This
is a **local client admission rejection**, not a newly executed native803.
The independently archived conflict-v15 remains the native803/rollback evidence.

The user action “Start a fresh request” only filled the form. A separate Prepare
and explicit query approval created fresh B60, which the real private computation
denied. Final SDK states were committed/stale/denied; quota version1. Three
callbacks independently matched their native amount commitments and Job statuses
(allow/allow/deny). Ten loaded ELFs matched and four exact signed tickets were
reviewed. See the [actual interface](assets/approvals-local-conflict.png).

Public evidence: [session review](../evidence/2026-10-02/approvals-conflict-v18-review.json),
[callbacks](../evidence/2026-10-02/approvals-conflict-v18-callbacks.json),
[stale API rejection](../evidence/2026-10-02/approvals-conflict-v18-stale-api.json).
Compatible evidence: [session review](../evidence/2026-10-02/approvals-compatible-v16-review.json),
[callbacks](../evidence/2026-10-02/approvals-compatible-v16-callbacks.json),
[browser restart observation](../evidence/2026-10-02/approvals-compatible-v16-browser-recovery.json).

Validation passed106 Node tests across SDK/client/examples/snapshot and verifier
suites, plus80 Python tests. Explicit host adapters remain distinct from these
real browser, validator and distributed-computation runs. The final UI regression
coverage includes no signing on reads, explicit final approval, exact retained
recovery, concurrent request exclusion and commit discovery after a signing-stage
failure. No qualified on-chain source changed.

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

## Current local services

At handoff, v18 remains running for inspection at `http://127.0.0.1:4317`:
server PID89462, validator PID86696 at RPC8971, Docker compose project
`cyperlink-approvals-conflict-v18`. The active session is
`.local/approvals-ui-conflict-v18`; its ledger is
`.local/localnet-approvals-conflict-v18/app/ledger`. Opening the page only observes; further spending
requires explicit approvals. Live observations may eventually show expiry instead
of stale as slots advance; the retained qualification reports preserve the run.
All v16 and Permissions services are stopped.

Before stopping, verify the recorded PIDs still belong to these commands (PIDs
can be reused). Send SIGTERM to the server and wait for `.server.lock` removal,
then stop its compose project and validator. Preserve all ledgers and journals:

```sh
docker compose -f .local/localnet-approvals-conflict-v18/app/artifacts/compose.json down
```

A rejected v17 preparation used an occupied RPC port; it created no run directory
or transactions. v18 used a separate free port and fresh generated state.
