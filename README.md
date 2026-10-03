# CyperLink

Make private money programmable on Solana.

Developers write private spending rules and state in their own application package.
CyperLink compiles and deploys that policy, then provides generated SDK bindings for
human-approved confidential payments. Native payment, private state consumption and
the exact paid application effect settle atomically. Account-wide decryption keys
stay with the client.

The working product is the bounded local owner/admin profile with merchant purchases
and expiring licenses. Bounded application/agent permissions are a separate escrow
experiment, not part of this supported payment path.

## Start here

- [Current status and next step](docs/STATUS.md)
- [Architecture and supported profile](docs/architecture.md)
- [Local setup](docs/local-bootstrap.md)
- [Write a policy and integrate the SDK](docs/custom-policy-authoring.md)
- [Evidence and limitations](docs/evidence.md)
- [Outside-builder exercise](docs/builder-exercise.md)

## Code

| Directory | Purpose |
| --- | --- |
| `packages/policy-cli` | Customer policy init, tests, compilation and local deployment |
| `packages/policy-client` | Generated session API, operation binding and exact recovery |
| `crates/policy-authoring` | Typed private-rule language and native commitment wrapper |
| `crates/client-proofs` | Client-owned keys and pinned upstream native proofs |
| `crates/native-admission` | Shared native proof/account/funding validation |
| `programs/custom-policy` | Current policy admission, settlement and consumer programs |
| `examples/license-session` | Explicit approval and recovery application |
| `examples/approvals` | Interactive local demo |
| `packages/sdk`, `packages/local-client`, `programs/native` | Shared infrastructure and retained legacy profile |
| `experiments` | Separately qualified probes, including scoped Permissions |

Use pinned dependencies. New ledgers, keys and raw evidence belong in ignored
`.local/` directories. This repository does not claim production security,
public-network deployment, fee-token compatibility or external customer validation.
