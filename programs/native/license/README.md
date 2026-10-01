# Expiring license consumer

Ported from `research/cyperlink-probes-2026-10-01/multi-app/license/src/lib.rs` in the original CyperLink research. This is a second same-author reference consumer, not independently authored external integration evidence. It calls the common operation interface and does not parse or manufacture permits.

Initialization is opcode `0` followed by product32, with `[payer signer writable, buyer signer, license PDA writable, executable System program]`. It creates a rent-exempt 81-byte zeroed record using PDA seeds `["license", buyer, product]`; it grants no entitlement or payment authority. Merchant initialization follows the same contract with sku8, seeds `["purchase", buyer, sku]` and 49 bytes.

Consumption remains opcode `2`, product32, absolute expiry slot8, explicit test-failure byte, and native transfer bytes, using the unchanged 17-account consumer ABI. The application digest binds license PDA, product, expiry, buyer, destination and mint. A successful shared-kernel settlement marks the license active atomically with payment and quota consumption. The nonzero test-failure flag forces full transaction rollback after the write.

The inherited expiry policy is unchanged: `current_slot < expiry <= current_slot + 1000` at consumption. Clients must choose and bind expiry before admission and allow for async computation; an expired license operation must be prepared anew. No silent expiry extension or renewal is implemented. Product IDs distinguish one-time records; a consumed record cannot be reset by initialization.

Host tests check malformed initialization and reject missing signatures/writable privileges, incorrect System program, nonexecutable System program, and a wrong record PDA before syscalls. Actual rent funding, PDA creation, owner signatures and authenticated consumption require the real-validator demo.

Original reference source SHA256: `2688b9acf7fc31038e031495cfeb1eef24413c70557f61cb5eda0f1ca4c33be8`.
