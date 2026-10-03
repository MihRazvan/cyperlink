# Architecture and supported profile

CyperLink connects native Solana confidential payments to customer-authored private
rules and shared state. The current offering is human-approved spending through
generated SDK sessions. Bounded permissions for applications/agents remain a separate
escrow experiment; owner-signed retries are not delegated execution.

## Operation

1. The client uses its locally retained account keys to generate native proofs and
   prepare the exact immutable payment/application action.
2. Owner and administrator explicitly approve one private query. Admission validates
   proof ownership/type/relations, native accounts and funding before computation.
   The Job binds the source/destination/mint, owner, proof and instruction bytes,
   source prestate, amount commitment, state version, consumer action and encrypted inputs.
3. Real Arcium computation authenticates the native amount commitment and evaluates
   the customer rule. A restricted, authenticated callback may admit its unique permit.
   Authorization neither reserves capacity nor issues an entitlement.
4. The owner separately approves settlement. Native transfer, quota compare-and-swap,
   permit consumption and exact application effect succeed or roll back together.
5. The SDK reconciles retained intent against a consistent account snapshot. Only a
   committed effect establishes payment; a callback or submitted signature does not.

Fresh computation needs fresh owner/admin consent, a new Job/permit and a nonrecycled
MXE-domain nonce. A valid query may disclose one allow/deny result even if later
abandoned. Administrator co-signing is a deliberate disclosure boundary, not an
unlimited preview endpoint. There is no automatic threshold search or silent renewal.

## Current deployment profile

`local-custom-policy-v1` uses synthetic local Token-2022 confidential assets with a
configured hook, ordinary owner signing wallets and explicit administrator admission.
Each policy deployment has its own quota, MXE key domain, generated programs and mint.
Multiple source owners can compete for that shared state. Same-mint multi-policy
routing, reservations and cross-MXE private calls are unsupported.

The no-fee adapter rejects transfer-fee extensions even at 0bps, any CPI Guard
extension, unsupported hooks/extensions, frozen/unapproved accounts and unsupported
instructions. Native multisig/delegates are excluded. AUSD requires a separate
fee-aware adapter; it is not enabled by the current implementation.

Customer source declares one to four private u64 fields; four cipher slots are always
present and unused slots must be zero. The typed-expression compiler uses pinned
Arcium/Arcis 0.15.0 ScalarField253 and CSplRescueCipher. High-level Arcis
BaseField255/RescueCipher is incompatible with this native commitment bridge.
The mandatory wrapper authenticates all 32 commitment bytes with the full opening,
and limits the native amount to less than 2^48. No plaintext or unchecked amount
substitution is permitted. Source/constants are public; confidential thresholds
belong in encrypted state. See [the language contract](compiler-gate.md).

| Account | Current custom profile |
| --- | --- |
| Private state | 353 bytes; full predecessor/successor, nonce and release/schema/domain bound |
| Permit | 712 bytes; permanent unique Job assignment |
| Job / PreparedAction | 1200 bytes each |
| Native action template | 464 bytes |
| Merchant entitlement | 49 bytes; exact buyer and one-time SKU |
| License entitlement | 81 bytes; exact buyer, product and expiry |

The transient active-permit route remains at state offset129. Only authenticated
settlement arms it, and native hook consumption clears it atomically. It must not
persist outside settlement. Source native prestate and quota version are checked
again at commit. Counter-only admission drift also invalidates delayed signed queries.

Legacy `local-native-ct-v0` has a different 161-byte quota and 520-byte permit. Its
code/archives remain supported by their explicit decoders; do not reinterpret those
accounts as custom-policy state or copy legacy fixed program identities into new apps.

## Authority and recovery

Deployment initializes once through authorized instructions and an authenticated
runtime callback. Loaded ELF and uploaded circuit/interface checks connect the
build to the running local instance. Program/circuit upgrade authorities, the
administrator and local RPC remain trusted. Hashes do not replace those authorities.
Two Arcium nodes on one host demonstrate distributed computation, not independent
operators. Current receipts use confirmed commitment, not a historical consensus proof.

Keep three independent facts in application output:

- **Payment/effect:** authorization, denial, staleness or committed account effect.
- **Delivery:** the retained signature and receipt availability/outcome.
- **Use now:** an issued merchant receipt or, for licenses, `licenseActive` at the
  observed slot. A paid but expired license stays paid without granting renewed access.

Generated sessions retain one signing attempt per descriptor/role before signing.
Keyless recovery verifies original bytes, signatures, action, lookup resolution and
ledger. It can discover a ticket lost after staging; it never replaces the transaction.
An interruption before signed-record publication blocks automatic restaging.
Explicit submit may finish simulation of the same bytes, but cannot renew expiry.

Recognized receipt/status network/HTTP outages can still reach the independent
account observer. Uncertain delivery cannot broadcast. If account access also fails,
the observation stays unresolved. Malformed/contradictory evidence remains fatal.
A null receipt is distinct from transport failure; neither proves payment failed.
A committed account effect does not prove that a particular signature landed.

Observation floors combine plan, signed record, validated retained receipts, status
context and successful account observations. Wire/ledger-bound local records retain
the maximum across restarts. Read-only recovery may write local metadata, never
onchain transactions. The current approval journal has a 4096-file discovery bound;
no compaction service exists. Genesis/ALT access still requires RPC.

When quota is exactly one version ahead, the observer verifies the complete authorized
successor. At later versions it relies on consumed permit plus exact paid effect under
the trusted atomic program invariants, not an independently reconstructed history.

## Limits

No production security claim, public-network qualification, clean-machine installation,
generic wallet/KMS support, key rotation, arbitrary provisioning crash recovery or
external customer advantage is established. Preserve client key backups and raw local
evidence; do not put secrets in docs or git. Exact pins/setup are in
[local bootstrap](local-bootstrap.md) and [toolchain details](local-toolchain.md).
