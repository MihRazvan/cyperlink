# Permissions feasibility: isolated authority investigation

Status: **native delegate route rejected by executable evidence; scoped escrow is a design, not a qualified product**. The existing Approvals programs, SDK, owner signatures, query snapshot binding and qualified ledgers are unchanged. This investigation follows the October 2 continuation brief and frontier research; it does not revive idea selection.

## Native authority finding

The pinned Token-2022 confidential `process_source_for_transfer` calls `Processor::validate_owner` with **the token account's base owner**. It does not select the ordinary delegate or permanent delegate. Native `Approve` can therefore succeed without granting authority for confidential transfers. A valid native proof does not supply this signature authority.

Inspected upstream checkout: `solana-program/token-2022`, commit `5bc7ea3b9568b9fdac2d08c921d73d40260249c7`, program manifest 11.1.0, `program/src/extension/confidential_transfer/processor.rs:868`. This source inspection is separate from byte identification of the executable: the probe loads the previously qualified Token-2022 ELF with SHA256 `0999dbf708971e723b08d1caafc988826a59c6001ed6dc02260da07defbe1469`. We do not claim a reproducible source-to-public-ELF build.

The same checkout's `program/src/processor.rs:730` permits account-owner rotation after the current owner's authorization, unless ImmutableOwner or CPI Guard disallows it. Confidential proof generation separately requires the source's ElGamal key and current balance witness. Assigning a PDA as token owner alone does not confer proof-generation capability.

## Executed negative

[`native-authority`](../experiments/permissions/native-authority/README.md) executes the exact native ELF in Mollusk 0.13.4, using fresh SDK 7.0.1 proofs verified by the native proof builtin into initially blank context accounts. Native `Approve(delegate,100)` succeeds. The owner-authorized control transfers 60. Changing only its authority to that approved delegate fails `OwnerMismatch` / Custom4, with byte-for-byte rollback of all accounts. Keeping the owner but removing signer privilege also fails with rollback.

This is **local SVM evidence with synthetic mint/source/destination state and supplied signer privileges**. It is not Ed25519 transaction evidence, real validator provisioning, distributed computation, or successful delegated execution. It deliberately omits the application hook to isolate Token-2022's own authority behavior. Amounts 100/60 are synthetic test-observer disclosures. Report: `.local/permissions-authority-v1/report.json` (generated, ignored).

## Authority choices

| Route | Signature authority | Proof access | Assessment |
| --- | --- | --- | --- |
| Native ordinary/permanent delegate | CT still requires token base owner | Source key still needed | Ordinary delegate rejected by executable probe; permanent-delegate shortcut is absent in inspected CT path. |
| Dedicated scoped escrow | A program PDA owns a new, capped token account; only the scoped grantee signs executions | Execution client holds **only that escrow's** ElGamal/AES keys | Smallest plausible unattended route; new custody/key/privacy and funding profile, still unqualified. |
| Owner-approved operation | Owner signs each exact current native action | Existing owner client keeps its own account keys | Existing Approvals profile; sealing an amount to an owner or replaying its prior signed bytes is not Permissions. |

Do not give an agent or MPC the user's existing account-wide keys. Do not silently use the owner's signer in an execution client. Dedicated escrow keys expose that escrow's balances and transaction history to the grantee; a program signature cannot prevent such disclosure. Keep encrypted policy state and wallet balances outside that key's scope.

## Smallest defensible escrow profile

A future isolated probe should use one synthetic no-fee mint, one dedicated confidential source, one fixed destination and one immutable semantic consumer action, with a grantee signing each execution. Its confidential funded balance is the **private, reserved spending capacity**. Native current-balance equality and range proofs enforce depletion; this is not yet CyperLink's separate encrypted Arcium business quota or an arbitrary private policy. No unknown-to-executor amount or distributed output proof generation is needed. Keep existing SDK7 proof generation; the frontier's Arcis/SDK4→SDK7 incompatibility is not solved by this profile.

The owner explicitly authorizes an atomic grant that installs a unique program-owned grant PDA and rotates only the dedicated source's token owner to that PDA. The grant binds chain/program domain, grant ID, initial owner, grantee, source/mint, recipient, consumer/action identity, expiry slot, bounded use count and recovery authority. Public fields reveal grant existence, endpoints, allowed action, expiry, uses and execution activity. Amounts and remaining balance stay confidential on-chain but are visible to the escrow key holders. Reject unsupported extensions, delegate/close authorities, CPI Guard, frozen state, fees, unexpected pending credits and incompatible mint controls.

Before handoff, complete funding and pending-balance application, then disable confidential and nonconfidential incoming credits. The scoped program must not expose deposit, mint, authority-rotation or arbitrary CPI entrypoints to the grantee. Otherwise replenishment can silently turn a capped initial balance into renewable permission. Further funding must be a new explicit grant/revision with new accounting, not an incidental inbound credit. Multiple grants need separate dedicated source accounts; several grants over one source would not reserve independent capacity.

Execution checks live grant status, signer, expiry (`slot < expiry`), expected next-use counter, exact recipient/action and native program/mint/source/proof accounts. It signs only the exact native CT CPI with its PDA, and advances the grant/use receipt and application effect in the same transaction. The native source ciphertext is the authoritative remaining-capacity state. A failed token CPI or failed effect rolls everything back. Native proofs for stale ciphertext fail; serialize preparation per source. A second grantee cannot safely assume an earlier observation reserves capacity.

## Query, revocation and recovery contract

- **Queries:** this minimal native-capacity probe has no MPC policy query, disclosed allow/deny oracle or automated administrator. If a shared private policy is joined later, the owner must separately grant a finite disclosure budget bound to policy release, input domain, permitted outputs, recipient, expiry and nonce domain. Consume it on admission, including denial or later settlement failure. Replaying the same signed query is the same request; stale-state rejection must not authorize fresh computation. Existing6004 semantics remain necessary.
- **Replay:** immutable grant identity plus monotone use counter, exact operation digest and current source ciphertext. Reusing an execution after success must fail even if its blockhash is refreshed. A blockhash timeout alone is not evidence that payment failed.
- **Expiry:** check at settlement, not just preparation. It stops further spending but cannot erase knowledge or restore already spent funds. Expired grants retain a recovery path.
- **Revocation:** owner-signed live-state revocation must contend on the same writable grant/source as execution. Whichever succeeds first defines the order. Revocation cannot undo a committed payment. If revocation rotates token ownership back, update grant status and native owner atomically.
- **Recovery:** owner must retain a backup of dedicated escrow proof keys at grant creation or approve a separately evaluated key recovery mechanism. Recovering only the token signing authority can leave funds unspendable. A hostile grantee can set an incorrect decryptable-balance field even when native ciphertext arithmetic is valid; refund tooling must recover from the actual ElGamal ciphertext, not trust that field blindly. Limit the experimental funded range to one the pinned SDK can actually decode, and test this path before promising unilateral refunds.
- **Lifecycle:** persist the grant descriptor, exact signed execution bytes, proof contexts and observation slots. Keyless recovery only observes/retransmits exact bytes. Fresh proofs, higher counter, changed destination/action and renewed private queries require a new explicit grantee operation. Revoke/recover must stay available after executor loss.

## Remaining success gate

The native delegate probe establishes a blocker for direct wallet delegation, **not** a blocker for all Permissions designs. A scoped escrow is not qualified until a separately loaded ELF and real local validator show an explicit signed grant, fresh executor-only native CT (owner absent from execution signers), atomic private-capacity and exact application effects, plus wrong recipient/action, overspend, stale proof, replay, revoked and expired rejection. Test grant provisioning, attempted replenishment, concurrent spends, rollback after native transfer and owner recovery. Keep signature, loaded-ELF and account evidence. A native-capacity result still must not be relabeled distributed private-policy enforcement.

Research references: continuation brief; frontier `arcium-native.md` scoped-key/output-proof sections, `crypto-frontier.md` consumable disclosure capabilities, `private-composability.md` funding/concurrency boundaries; original `CYPERLINK.md` sections27–28. These are design inputs, not additional executed evidence.
