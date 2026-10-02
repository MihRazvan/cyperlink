# Product continuation: Approvals, then Permissions

Accepted 2026-10-02. The product continuation brief at
`/Users/razvan/Repos/colosseum/research/cyperlink-frontier-2026-10-02/PRODUCT-CONTINUATION-BRIEF.md`
supersedes the research-first ordering, not the qualified SDK/profile. Baseline:
`f5304f2`, compatible-v13 and conflict-v15. Company direction: programmable privacy
infrastructure for Solana. Approvals and Permissions are working names for two
authority modes over shared infrastructure, not two launched products.

## Current result

The interactive milestone passed on fresh compatible-v16 and conflict-v18 ledgers,
including real browser approvals and paid effects, restart recovery, stale client
rejection and fresh authenticated denial. The isolated Permissions probe also
passed for a dedicated native-balance escrow with a scoped receipt, preserving
explicit limits. See [qualification](approvals-qualification.md) and
[authority feasibility](permissions-feasibility.md). These are local results,
not a general-availability launch or Arcium-integrated Permissions mode.

## First milestone: interactive human-approved spending

- A thin loopback-only browser surface uses `LocalOperationClient` for real native
  preparation, explicit owner/admin query approval and exact final owner approval.
  Runtime setup is an explicit bootstrap step; opening or refreshing the page
  never authorizes a query or a payment.
- Show the merchant SKU and product license as two reference applications with
  independent source owners sharing one private allowance/MXE. Show the exact
  proposed effect, SDK lifecycle state, actual paid effect and recovery choices.
- Separate the authorized local client's amount display from a public observer
  projection. Label initial allowance and inferred remainder as synthetic
  test-observer disclosures. Public identities, timing and decisions are visible.
- Retain completed plans and signed tickets. A lost response or restarted process
  can reconcile or explicitly resend identical bytes. It cannot replace a
  blockhash, refresh stale approval or issue a new private query automatically.
- Qualify compatible and conflict paths through the UI/API with fresh real local
  validators and two-node runtime. Check loaded ELFs, actual paid effects and one
  lost-response/restart. Reuse prior native adversarial evidence where unchanged.

The signer service is a local client process, explicitly unlocked with disposable
local signing files. It is not a hosted signing backend or a general wallet/KMS
integration. Reusable ElGamal/AES keys and private witnesses stay in the existing
client-owned files; neither API projections nor recovery workers receive them.

## Second milestone: isolated Permissions feasibility

Inspect exact native authority/proof source and executable behavior. Compare
delegation, scoped program escrow and owner-approved execution; specify asset,
recipient/action scope, funds control, proof keys, consumable query authority,
expiry/revocation, concurrency, replay and unavailable-client/MPC recovery.
Keep final amounts known to the authorized execution client initially.

A positive probe needs a real native confidential action after an initial grant
without another owner execution signature, exact application effect and private
capacity consumption, plus rejected wrong recipient/action, overspend, replay,
revoked and expired grants. A pre-signed owner transaction or automatic owner-key
signer does not qualify. Negative native authority/key evidence is useful and
must remain explicit; never weaken the existing profile to make a probe pass.

New authority code/experiments stay under `experiments/permissions/` and ignored
`.local/permissions-*`; the qualified Approvals programs, circuits and locks remain
unchanged unless an independently reviewed change is necessary.

## Later research and open gates

Cross-MXE handoffs, independent native capacity proofs and unknown-to-owner
computed payouts remain separate research. Arcis 0.15/SDK4 output-proof failures
against SDK7 are a real compatibility gate; retain client SDK7 proofs and do not
downgrade verification. A single allow/deny decision is disclosure; unlimited
adaptive queries are not a safe replacement for administrator authorization.

Second-machine clean installation remains unqualified. Another process or
container on this host does not close it. No public-network writes, real funds,
third-party contact or production deployment are in scope.
