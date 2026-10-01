# Transient permit routing

Quota layout v1 has 161 bytes: the original 129 bytes are unchanged, and bytes 129–160 hold an active permit public key. This is a new local deployment layout; legacy 129-byte quotas are rejected. The quota version at bytes 0–7 remains the policy state version, not a layout version.

Canonical mint hook metadata contains exactly two nonsigning writable entries: fixed quota Q at Execute account index 5, then a public key from quota data at offset 129, producing the permit at index 6. Metadata must have the expected mint/hook PDA, H ownership and exact upstream-generated 86-byte encoding. Validation rejects alternate offsets, fixed permits, privilege changes, extra entries and trailing data.

H's guard-only arm checks an idle pointer, valid admitted permit, expiry and quota version/digest, then atomically marks the permit armed and installs its key. Native Token-2022 resolves that live pointer before invoking H. H checks the selected permit, exact native account binding, metadata, both native transferring flags and source ciphertext, advances quota, consumes the permit and clears the pointer. The guard must reject unless both consumption and pointer clearing occurred. Failure anywhere rolls back the transaction. Callback admission, cancellation, initialization and nonce allocation require an idle pointer.

The SDK supplies the Job's known permit and quota accounts explicitly. Generic offchain resolution against an idle quota would read a zero key; the pointer deliberately exists only during execution. Every operation uses a fresh permit and immutable claim; routing does not recycle authorization.

Dependencies use the research lock's exact TLV resolver 0.11.4 and hook interface 2.1.0. `cargo test --locked --offline --manifest-path crates/hook-routing/Cargo.toml` validates the schema and exercises the upstream CPI resolver with distinct live pointers. These are host resolver tests. Captured Token-2022 binary compatibility, atomic rollback and loaded-ELF correspondence require fresh validator execution.
