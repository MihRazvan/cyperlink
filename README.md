# CyperLink

Make private money programmable on Solana.

CyperLink joins an exact native confidential payment, authenticated private shared-state policy and its application effect in one atomic settlement. Reusable account decryption keys stay with the client. Authorization alone is never reported as payment.

The initial implementation supports synthetic local Token-2022 assets, one private allowance/MXE, explicit owner and administrator query signatures, and two internal consumers: a merchant SKU and an expiring product license. Fees, including fee extensions configured at 0 bps, require a separate adapter.

Start with the [current status and decisions](docs/STATUS.md), [supported profile](docs/initial-profile.md), and [validation matrix](docs/validation.md). For local execution, follow the [fresh bootstrap guide](docs/local-bootstrap.md), then the [interactive Approvals client](examples/approvals/README.md) or [scripted two-consumer demo](examples/two-consumers/README.md). The current path uses repository sources and pinned upstream artifacts; historical research stays read-only. New ledgers, keys and evidence stay under ignored `.local/` directories.

[Interactive qualification and screenshots](docs/approvals-qualification.md) cover compatible payments, stale rejection, fresh denial and restart recovery. [Permissions feasibility](docs/permissions-feasibility.md) is a separate scoped escrow experiment; it is not enabled in the supported Approvals profile.

Developer APIs:

- [Customer-authored private policies](docs/custom-policy-authoring.md): write original private rules/state, compile packages and use generated local SDK bindings; custom runtime qualification is in progress.
- [`@cyperlink/sdk`](packages/sdk): exact native/action builders and authenticated merchant/license lifecycle observations; [operation contract](docs/operation-contract.md).
- [Local client](packages/local-client): signed native account provisioning, fresh proof submission and proof-buffer cleanup.
- [Rust client proofs](crates/client-proofs): persistent client-owned keys and pinned upstream cryptographic proof generation.
- [Shared native validation](crates/native-admission): the strict no-fee admission and settlement boundary.

This is local developer infrastructure continuing validated research. Evidence distinguishes host tests, signed simulations, actual validator transactions and distributed computation. It establishes neither production security nor public-network/asset compatibility or external customer adoption.
