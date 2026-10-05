# CyperLink

Make private money programmable on Solana.

Developers write private spending rules and state in their own application package.
CyperLink compiles and deploys that policy, then provides generated SDK bindings for
human-approved confidential payments. Native payment, private state consumption and
the exact paid application effect settle atomically. Account-wide decryption keys
stay with the client.

CyperLink Console brings that workflow into a local project workspace: a payment
inbox, explicit native-preparation/query/payment approvals, and recovery of original
signed deliveries. It connects to an already deployed policy through generated SDK
sessions. The supported owner/admin profile uses synthetic local assets for merchant
purchases and expiring licenses. Bounded application/agent permissions remain a separate
escrow experiment, not part of this payment path.

## Start here

- [Current status and next step](docs/STATUS.md)
- [Launch CyperLink Console](apps/console/README.md)
- [Architecture and supported profile](docs/architecture.md)
- [Local setup](docs/local-bootstrap.md)
- [Write a policy and integrate the SDK](docs/custom-policy-authoring.md)
- [Evidence and limitations](docs/evidence.md)

With a completed local deployment and its runtime running, open an observation session:

```sh
node packages/policy-cli/cyperlink.mjs console \
  --instance .local/my-instance/instance.json \
  --directory .local/my-console
```

Open `http://127.0.0.1:4321`. The [Console guide](apps/console/README.md) explains
explicit local signer configuration and restarting the same workspace for recovery.
Policy authoring, testing, building and deployment currently use the CLI; Console
onboarding and build/deploy controls are next product work. No browser wallet is implied.

## Code

| Directory | Purpose |
| --- | --- |
| `apps/console` | Local project workspace, payment inbox, human approvals and recovery |
| `packages/policy-cli` | Customer policy init, tests, compilation and local deployment |
| `packages/policy-client` | Generated session API, operation binding and exact recovery |
| `crates/policy-authoring` | Typed private-rule language and native commitment wrapper |
| `crates/client-proofs` | Client-owned keys and pinned upstream native proofs |
| `crates/native-admission` | Shared native proof/account/funding validation |
| `programs/custom-policy` | Current policy admission, settlement and consumer programs |
| `examples/license-session` | Explicit approval and recovery application |
| `examples/license-app`, `examples/policies` | Paid-license reference, distinct customer policies and live qualification |
| `packages/sdk`, `packages/local-client` | Shared native provisioning, transaction journal and account observation |
| `programs/native`, `programs/auth`, `circuits/budget` | Pinned bootstrap dependencies still required by local setup |

Superseded demos, research replay and separate Permissions/direct-client experiments
are preserved at Git tag `console-reference-v2`. Their evidence remains indexed in
[evidence](docs/evidence.md); they are not additional supported product entrypoints.

Run maintained JavaScript checks with `python3 scripts/setup_local_js.py --check --test`
and bootstrap checks with `python3 -m unittest discover -s tests -v`. Both use the
existing pinned environment; live qualification remains a separate explicit step.

Use pinned dependencies. New ledgers, keys and raw evidence belong in ignored
`.local/` directories. This repository does not claim production security,
public-network deployment, fee-token compatibility or external customer validation.
