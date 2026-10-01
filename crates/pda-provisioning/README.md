# PDA provisioning with prior funding

System `create_account` rejects a target with positive lamports. Predictable quota, metadata and entitlement addresses can be funded by anyone before initialization, so unconditional creation made those addresses unavailable.

After the caller authenticates its administrator/buyer and exact semantic PDA, `create_pda` verifies the target is still an empty System-owned account and verifies its signer seeds. It adds only missing rent, allocates the PDA data, then assigns ownership using the program's PDA signature. Existing donations remain in the account. Initialized or differently owned accounts cannot be reset. All CPI effects roll back together if any step or later initialization fails.

Host tests cover rejection before funding for missing signatures, existing data/ownership, wrong system identity/executability and mismatched seeds. Successful prefunded provisioning requires the real-validator v4 demonstration; host tests do not emulate System execution.
