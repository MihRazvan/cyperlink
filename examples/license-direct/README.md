# Direct pinned upstream license client

This runnable internal baseline directly calls web3.js 1.99.0, Anchor JS 1.2.0,
Arcium 0.15.0 and the existing native SDK 7.0.1 proof CLI. It performs its own
proof-context uploads/verification, action construction, encryption, queueing,
account reconciliation, payment instruction assembly and durable wire recovery.
It does not import a CyperLink JavaScript SDK, generated `connect`, durable sender
or recovery worker. The reference `examples/license-app` remains unchanged.

**This is a client integration comparison using shared CyperLink enforcement.**
The deployment, policy compiler/circuit, admission/Auth, kernel/guard, policy hook,
license consumer and initially funded native assets are common setup. The same
private positive-payment rule enforces `amount <= purchase_cap` and
`amount <= remaining`, subtracts payment only at settlement, and grants exactly
buyer/product/absolute-expiry. The intended synthetic observer fixture is
remaining50/cap30. This client neither implements nor measures an independent
standalone upstream replacement for those programs. Full standalone comparison
and comparative productivity/maintenance claims remain **inconclusive**.

The shared Rust CLI is also counted separately: its upstream-native amount/opening
bridge and client-side ElGamal/AES account-key storage are reused. Shared provisioning
creates initial native assets and deployment. This client invokes the CLI only for
fresh native proof generation, then directly creates/verifies real proof contexts.
Arcium provides encryption/PDA/Anchor plumbing, authenticated output verification
in the shared programs and upstream polling; Solana supplies native proofs and
transaction rollback. None is claimed as original CyperLink cryptography.

Run from the repository root with an existing fresh local deployment instance,
explicit owner/admin and native asset directory. Expiry must still be in the future
and within1000 slots at payment. Replace values with your qualified fixture paths:

```sh
node --test examples/license-direct/app.test.mjs
node examples/license-direct/app.mjs prepare \
  --instance .local/direct-license-instance/instance.json \
  --operation .local/direct-license-buy30 \
  --admin-keyfile .local/direct-license-runtime/app/local-test-wallet.json \
  --owner-keyfile .local/direct-license-instance/asset-b/source-owner-signer.json \
  --amount 30 --product aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  --expiry-slot 1000 --label buy30
```

`approve-query` and `approve-payment` take the same instance, operation and explicit
admin/owner keyfile arguments; omit amount/product/expiry/label. Each saves its
complete signed `query-wire.json` or `commit-wire.json` before simulation or send.
`--submit no` stages only. Repeating approval reads the retained wire and never
refreshes the blockhash, nonce, encrypted inputs or signatures. `observe` accepts
only instance/operation and never signs. A genuine callback yielding `authorized`
is not payment; only a consistent snapshot of the consumed permit, exact license
and advanced quota yields `paymentCommitted: true`.

Recovery is a fresh keyless invocation of this direct application:

```sh
node examples/license-direct/app.mjs recover \
  --instance .local/direct-license-instance/instance.json \
  --operation .local/direct-license-buy30 --role commit
```

Add `--submit yes` only for explicit identical-byte retransmission. Recovery verifies
all Ed25519 signatures, exact instruction reconstruction, retained plan hash,
ledger, owner/admin, ALT resolution and the immutable PreparedAction for queries.
A missing receipt remains unresolved even if a signature status exists. Expired
unresolved wires never become presumed failures or fresh transactions. Each observed
single-bank snapshot is persisted and imposes a minimum slot on later observations.
Local files are the trusted retained approval record, not adversarial remote storage.
No automatic new query, administrator signing, key replacement or expiry renewal
is provided. Preparation and approvals themselves are explicit authorization to
use the supplied local signing files.

Provisioning/action preparation transactions are individually retained too, but
arbitrary interrupted preparation is not automatically resumed. An interrupted
approval lock requires manual inspection; if a complete role wire exists it can be
recovered directly. Shared funded asset provisioning and deployment recovery are
outside this bounded client. Observation trusts confirmed local RPC; it is not an
offline BLS verifier, a historical consensus proof or a production wallet.

The final hardened rehearsal passes on a fresh instance and the existing local
validator/two-node runtime. `.local/direct-license-qualification-v22c/results.json`
retains five genuine callbacks: deny40, allowA30, allowB30, deny freshB30 and allow
freshB20. A30 and freshB20 issue their exact paid licenses. Actual transactions
reject post-native rollback1199, stale803 and replay1102 with36 unchanged tracked
account comparisons. Ten loaded ELFs and two uploaded circuits match their builds.
The application sources are copied and hashed before execution and checked unchanged
after the run. The older incomplete v22 attempt and successful earlier v22b run
are preserved separately.

Five actual SIGKILL windows are recorded: query after wire, query after simulation,
payment after wire, payment after simulation, and before a role wire is installed.
Fresh keyless processes leave readonly snapshots unchanged, recover the same signed
messages, and never create another query. Missing simulation reports
`simulation-required`; explicit submission can simulate that exact wire and save
the result before sending. The before-wire interruption retains its immutable
approval intent and refuses both keyless recovery and repeated signing. It needs
manual inspection; automatic completion of that partial state is not claimed.
Actual acknowledgement loss and injected receipt unavailability also preserve the
original paid signature. A consistent committed account effect may establish payment
while receipt delivery still reports unavailable; an allowed callback alone cannot.

Durable attempts are capped at three, retained simulation is signature/wire-bound,
blockhash validity and context floors are checked, and expired unknowns stay
unresolved. Nine host tests cover those delivery guards; the live run does not
independently qualify every malicious RPC, disk-loss or expiry scenario.

The [independent archive verifier](verify.mjs) checks15 signed messages/25 Ed25519
signatures, seven exact operation wires, five callbacks, two paid effects, three
rollback/stale/replay failures, seven durable broadcast records, five crash windows
and60 unchanged readonly account comparisons. Its SDK semantic oracle is used only
for offline qualification, never by the direct application. Nine archive-corruption
variants reject. It does not independently verify Arcium BLS or historical consensus.
Reproduce the bounded run and offline review with:

```sh
node packages/policy-cli/cyperlink.mjs policy deploy examples/license-app --local \
  --environment .local/localnet-license-app-v21/preparation.json \
  --initial-state .local/license-session-initial-v22.json \
  --out .local/license-direct-instance-next
node examples/license-direct/qualify.mjs \
  .local/license-direct-instance-next/instance.json .local/direct-license-new-run
node examples/license-direct/verify.mjs \
  --results .local/direct-license-new-run/results.json \
  --instance .local/license-direct-instance-next/instance.json \
  --output .local/direct-license-new-run/independent-review.json \
  --corruption-output .local/direct-license-new-run/independent-corruptions.json
```

A new full qualification requires a newly initialized remaining50/cap30 instance;
reusing the completed instance will correctly observe spent policy state. The commands use the already prepared local environment and synthetic initializer
from this session. Shared deployment/provisioning runs first; all new runtime
identity/secrets stay under `.local/`.

Broader failure-mode equivalence, a separately implemented upstream enforcement
stack and any human productivity/maintenance advantage remain **inconclusive**.
The full direct adversarial matrix has not newly exercised substituted owner,
destination/product/expiry, mismatched native commitment or a forged callback;
those remain shared-enforcement/review evidence rather than direct-run claims.
See [FRICTION.md](https://github.com/MihRazvan/cyperlink/blob/builder-exercise-v1/examples/license-direct/FRICTION.md) and the [comparison summary](../../docs/evidence.md).
