# Initial supported profile: local native CT v0

CyperLink makes private money programmable: a native Solana confidential payment obeys private shared-state policy and grants its exact application effect atomically. Reusable ElGamal/AES account keys stay client-side. Only the operation amount/opening enter encrypted MPC inputs.

The initial qualification target is synthetic local Token-2022 assets, a configured CyperLink hook, one quota per MXE/key domain, optimistic versioned allowance, explicit source-owner and policy-administrator signatures, and owner-signed commit. No permissionless preview or automatic administrator signing is supported. A valid query is not a reservation or a promise that future settlement succeeds.

The no-fee adapter rejects fee extensions even at 0 bps, CPI Guard, unsupported hooks/extensions, frozen/unapproved accounts and unsupported instruction variants. Exact extension allowlists and native proof/account relationships are enforced before computation. Source, destination, mint, owner, native instruction/proof bytes, source prestate, amount commitment, consumer and semantic action are bound. Settlement checks current state again.

The administrator explicitly authorizes each immutable operation, chosen circuit/output disclosure and computation request. Each accepted request can publicly reveal one allow/deny decision, including valid abandoned requests. This trust boundary is intentional; funded-query validation alone does not prevent threshold inference. Retries that recompute need fresh administrator and owner authorization, a fresh Job/permit and a nonrecycled MXE-domain nonce. No background threshold search, automatic renewal or unlimited query endpoint is permitted.

Pinned baseline: Agave 4.3.0, solana-zk-sdk 7.0.1, Token-2022 interface 3.1.0, proof interface 0.1.3, Arcium Rust/client/compiler 0.15.0, Anchor 1.0.2, SBF tools 1.57 arch v0; preserve lockfiles. Captured Token-2022 ELF SHA256 `0999dbf708971e723b08d1caafc988826a59c6001ed6dc02260da07defbe1469` is local execution input, not a new public-network result.

Excluded: AUSD (requires a separate five-proof fee-aware adapter), production/public-network deployment, general token extensions, reservations, multi-quota allocation, account key rotation, unattended variable payouts, production receipts and external integration claims. Upgradable program/circuit trust remains explicit. Test observers may see synthetic plaintext, clearly labeled; public views must not suggest hidden account identities/timing.
