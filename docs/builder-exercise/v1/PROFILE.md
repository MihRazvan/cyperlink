# Supported profile and setup

The exercise targets `local-custom-policy-v1`, not the legacy 161-byte quota ABI.
The custom profile uses 353-byte private state, a 712-byte permit and four encrypted
u64 slots (one to four declared fields; unused slots must be zero). It uses the
merchant one-time SKU effect. The existing license adapter is an optional supported
choice for a real intake; it is not a new consumer implementation exercise.

Native Token-2022 confidential payments use synthetic local assets, a configured
hook, ordinary source-owner signatures and explicit administrator query co-signing.
There is no transfer-fee extension even at 0bps, CPI Guard, delegate or multisig.
No AUSD, autonomous Permissions, private external inputs/oracles, cross-MXE calls,
state migration, arbitrary consumer ABI or production/public-network execution.
Each deployment has its own policy programs, MXE key domain, quota and synthetic
mint; two funded source owners may compete for the same private policy state.

Authoring uses typed Rust expressions with ScalarField253/CSplRescueCipher. Source
and source constants are public. Confidential thresholds belong in encrypted state.
High-level Arcis BaseField255/RescueCipher is not interchangeable with this native
amount bridge. The wrapper authenticates the exact native amount commitment with
its full opening; native amount is less than 2^48. Account-wide decryption keys stay
in the client's private files. The administrator approves every query/disclosed
allow-or-deny result, including abandoned queries. No automatic retry authorizes a
fresh disclosure. Trusted upgrade authorities, local RPC and same-host two-node
runtime remain explicit; this is not independent operators or a security audit.

## Pinned baseline

| Component | Version |
| --- | --- |
| Node / npm | 24.12.0 / 11.6.2 |
| Host Rust / Cargo | 1.95.0 (`59807616e`) / 1.95.0 (`f2d3ce0bd`) |
| Auth workspace Rust | 1.89.0 |
| Agave | 4.3.0 |
| SBF platform tools / architecture | 1.57 / v0 |
| Arcium Rust/client/compiler | 0.15.0 |
| Anchor Rust/IDL / JavaScript | 1.0.2 / 1.2.0 |
| web3.js / bn.js | 1.99.0 / 5.2.5 |
| Native ZK SDK | 7.0.1 |
| Token interface / proof interface | 3.1.0 / 0.1.3 |
| Policy authoring crate | 0.1.0, tooling-provided local path |

Keep all repository lockfiles and artifact/image hashes. Qualification covers the
Darwin ARM64 development host with Docker Linux AMD64 support and existing caches.
Python 3 and the pinned dependencies are prerequisites. Do not replace unavailable
pins with latest. Report an unavailable artifact/cache/toolchain as an environment
blocker before interpreting integration results.

The deployment path requires the documented **fresh local genesis** SIMD-0500
feature override for SBF v0. It is not default Agave feature parity. Use
[bootstrap](../../local-bootstrap.md) and the deployment section of
[authoring](../../custom-policy-authoring.md); do not run their completed demos or
copy a sample policy as the builder's answer. Preserve all previous ledgers. Only
one validator should own the host faucet port 9900; preparation also probes 8899.
Do not stop unrelated services or reset an existing ledger to obtain fresh state.

## Ready-runtime handoff

Evaluator records baseline/freeze identity, pinned verification reports, runtime
preparation path, loopback endpoint/genesis, Docker project, explicit feature override,
module root, proof CLI path, toolchain/cache state and setup assistance. No keys go
in the public run record. Assign a new run identifier and unused directories:

- `.local/builder-RUN/customer-app/`: builder policy, tests and application.
- `.local/builder-RUN/initial-state.json`: owner-only initializer, mode 0600.
- `.local/builder-RUN/instance/`: new deployment output, initially absent.
- `.local/builder-RUN/operations/OP/`: new operation, initially absent.
- `.local/builder-RUN/approvals/`: stable SDK session directory across restarts.
- `.local/builder-RUN/evidence/`: private evaluator records and failed attempts.

Create the parent privately; leave application/deployment/operation outputs absent
for tools that require fresh paths. Do not reuse the research/reference instances.
From repository root, builder uses the supported CLI:

```sh
node packages/policy-cli/cyperlink.mjs policy init .local/builder-RUN/customer-app
node packages/policy-cli/cyperlink.mjs policy test .local/builder-RUN/customer-app
node packages/policy-cli/cyperlink.mjs policy build .local/builder-RUN/customer-app
node packages/policy-cli/cyperlink.mjs policy deploy .local/builder-RUN/customer-app \
  --local --environment .local/localnet-RUN/preparation.json \
  --initial-state .local/builder-RUN/initial-state.json \
  --out .local/builder-RUN/instance
```

`RUN` and environment path are placeholders assigned before testing. Initializer
keys exactly match ordered schema field names, with canonical decimal-string u64
values. Keep them out of public source and commit history. Successful deployment
returns `instance.json`, actual loaded ELF/circuit checks and real initialization
callback evidence; failed/partial deployment is not a ready instance. Provisioning
crash recovery is unqualified. Preserve failures; agree a separately recorded fresh
attempt rather than overwriting one. No production keys or private RPC are needed.
