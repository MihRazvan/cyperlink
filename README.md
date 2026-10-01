# CyperLink

Make private money programmable on Solana.

CyperLink joins an exact native confidential payment, authenticated private shared-state policy and its application effect in one atomic settlement. Reusable account decryption keys stay with the client. Authorization alone is never reported as payment.

The initial implementation supports synthetic local Token-2022 assets, one private allowance/MXE, explicit owner and administrator query signatures, and two internal consumers: a merchant SKU and an expiring product license. Fees, including fee extensions configured at 0 bps, require a separate adapter.

Start with the [current status and decisions](docs/STATUS.md), [supported profile](docs/initial-profile.md), and [validation matrix](docs/validation.md). For local execution, follow the [pinned build and replay guide](docs/local-replay.md), then the [two-consumer demo](examples/two-consumers/README.md). Existing research is a read-only dependency; new ledgers, keys and evidence stay under ignored `.local/` directories.

Developer APIs:

- [`@cyperlink/sdk`](packages/sdk): exact native/action builders and authenticated merchant/license lifecycle observations; [operation contract](docs/operation-contract.md).
- [Local client](packages/local-client): signed native account provisioning, fresh proof submission and proof-buffer cleanup.
- [Rust client proofs](crates/client-proofs): persistent client-owned keys and pinned upstream cryptographic proof generation.
- [Shared native validation](crates/native-admission): the strict no-fee admission and settlement boundary.

This is local developer infrastructure continuing validated research. Evidence distinguishes host tests, signed simulations, actual validator transactions and distributed computation. It establishes neither production security nor public-network/asset compatibility or external customer adoption.
