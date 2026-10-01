# Upstream proof generation provenance

`vendor/proof-generation` contains the recorded research transfer generator from
`research/devtools-2026-10-01/evidence/ct-policy-spike/token-2022/confidential/proof-generation`.
That checkout's manifest identifies **0.6.1**, SDK **7.0.1**, not registry proof
generation 0.5.1 (which uses SDK 4). Using the registry 0.5.1 package would silently
change the tested SDK/transcript. This crate preserves the tested local generator.

`src/transfer.rs`, `src/encryption.rs`, and `src/errors.rs` are exact byte copies.
`src/lib.rs` only drops module declarations for unrelated mint/burn/fee/withdraw
operations. `source-hashes.json` records original full-file SHA256 values. The
Apache-2.0 license is retained. The research addition
`research_transfer_split_with_opening` returns the combined low/high Pedersen
opening while using the upstream SDK proof builders unchanged. No account-wide
key is part of that return value.

The vendor manifest is standalone and exact-pinned. Its proof interface is
0.1.3, the version resolved in the original native runner lockfile (whose manifest
allowed 0.1.2); its thiserror is the recorded resolved 2.0.21. The new crate's
lockfile was seeded from that native runner lockfile and pruned by Cargo offline.
Other direct dependencies likewise use the recorded resolved versions. No
dependency was changed to a newly fetched latest version.

The wrapper freshly verifies all generated proofs with SDK 7.0.1 before exposing
them. This is client cryptographic evidence only. Submission to the validator's
native proof program is still required to create authenticated context accounts.

