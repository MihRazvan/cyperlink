# Fresh local bootstrap

This path uses repository sources, exact dependency locks and hash-pinned public artifacts. It does not read the original research checkout or copy its administrator/node identities. Historical replay is indexed under [evidence](evidence.md).

Qualification currently covers Darwin ARM64 on the development host. Prerequisites are Python 3, Node 24.12.0/npm 11.6.2, Docker with Linux AMD64 support, host Rust/Cargo 1.95.0 and the auth workspace's pinned 1.89.0 toolchain. The SBF launcher selects platform-tools v1.57/arch v0. Existing Rust crate and SBF platform caches remain host dependencies; a blank-machine installation and independent compiler-byte qualification have **not** been demonstrated.

## Install and build

From the repository root:

```sh
python3 scripts/setup_local_js.py --test
python3 scripts/setup_local_toolchain.py --pull-images
python3 scripts/setup_local_toolchain.py --verify-only
python3 scripts/rebuild_circuits.py --out .local/circuits-01
python3 scripts/build_local.py --toolchain .local/toolchain/native
```

The native installer downloads exact release assets and checks recorded SHA-256 hashes. `--pull-images` allows only pinned image digests; omit it when images are already cached. Token-2022 and Lighthouse are fetched through keyless public **read-only** account RPC and must match the recorded deployed bytes. No public transaction is sent. An upstream upgrade or missing pinned release fails setup rather than accepting new bytes. See [native toolchain details](local-toolchain.md) and [JavaScript dependency provenance](../config/local-js/README.md).

Circuit rebuilding compiles both real runtime circuits from the locked source into a fresh directory and requires all eight output files to match the reviewed artifacts exactly. It uses cached crates by default; `--allow-network` permits fetching locked dependencies. Program building uses locked dependencies offline, emits the six implementation ELFs, IDL and local proof CLI, and never deploys. A host circuit build is distinct from distributed execution.

## Prepare and run

Choose a new run ID and unused ports for each scenario:

The pinned upstream generator probes `127.0.0.1:8899` even when a different final RPC port is requested. Stop your own validator on that port before preparation. If another service owns it, leave that service alone and prepare when the port is available. An occupied default port can make the upstream CLI select an unexpected `anchor test` path; our wrapper rejects that path. Preserve any failed preparation and choose a new run ID.

```sh
python3 scripts/prepare_localnet.py --run-id demo-01 \
  --circuits .local/circuits-01/compiler/build
```

Preparation generates a new administrator wallet, node BLS/X25519/signing identities and 60 upstream runtime genesis accounts using the pinned Arcium CLI. The CLI lacks a generation-only command, so a checked wrapper intercepts its service launch. The resulting raw upstream Compose is retained as disabled evidence; only the reviewed three-service, digest-pinned Compose is executable through this guide. Recovery identities are generated but recovery is not exercised. No CyperLink-owned genesis state, token assets, proof contexts or preauthorized permits are injected.

Run one generated validator at a time on this host: the pinned validator also
uses the default faucet port 9900, independent of `--rpc-port`. Stop the previous
run's validator and Compose project before starting the next. A startup collision
can leave a partial ledger; preserve it and prepare a new run ID.

From the printed application directory, start these in separate terminals:

```sh
python3 run-validator.py
```

```sh
docker compose -f artifacts/compose.json up -d --pull never
```

Back at the repository root, follow [customer policy authoring and deployment](custom-policy-authoring.md)
to deploy a fresh policy and integrate generated `connectSession` bindings.
For the retained legacy fixed-allowance demo, use the separate
[two-consumer runner](../examples/two-consumers/README.md). Do not mix its fixed
program identities or account layouts into a new custom-policy instance.

For **custom policy deployment**, prepare with
`--allow-pinned-sbf-v0-deployment` in addition to your chosen run ID/ports. This
explicitly disables SIMD-0500 feature `B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g`
at fresh local genesis so pinned SBF v0 deployments are accepted. It is not default
Agave feature parity or public-network deployability. Do not alter an existing ledger.

Preparation requires fresh output, selects an unused Docker subnet and refuses reused
runtime share state. Both profiles use fresh runtime identities and actual native proof
verification; new account data/permits are never injected as a substitute. Setup and
scenario qualification are different stages; [evidence](evidence.md) records what ran.

## Evidence and shutdown

Keep ignored `.local/` outputs: preparation/generation manifests, loaded ELF reports, signed receipts, source snapshots, raw before/after tracked account snapshots and full results. Keys and worker shares remain local. Snapshots use a single confirmed bank read for each group; these are retained RPC observations, not independent historical state proofs or finality claims. Failed transaction fees still apply to the payer outside the tracked application accounts.

Stop only the selected run's Compose project from its application directory:

```sh
docker compose -f artifacts/compose.json down
```

Stop that validator with Ctrl-C in its own terminal. Preserve its ledger and evidence. No global Docker cleanup or validator reset is needed.

The two nodes and trusted dealer run on one developer host. This demonstrates actual local distributed computation, not independent operators or production security. Provisioning/proof, circuit upload, queue, callback and settlement costs remain separate; worker resource costs are not measured.
