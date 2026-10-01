# Historical same-machine replay

For new development, use the [fresh bootstrap guide](local-bootstrap.md), which generates new identities and removes the original-checkout dependency. The commands below preserve the earlier research-dependent path.

The default profile starts a fresh Agave ledger with only the 61 required Arcium runtime genesis accounts. Native tokens, proof contexts, permits, quota, routing metadata and consumer entitlements are created through signed instructions by the [two-consumer example](../examples/two-consumers/README.md). Runtime keys and callbacks come from two fresh Arcium nodes. This is local validator/distributed evidence, not public-network execution.

## Pinned prerequisites and build

This is currently a **same-machine replay**, not a clean-machine bootstrap. It reads the original research tree, its Agave 4.3.0 binary, installed JavaScript modules, captured Token-2022 ELF and pinned runtime circuits. Docker must already contain the digest-pinned Arcium images. Preparation pulls no images and never writes to the original research checkout.

JavaScript versions are `@arcium-hq/client` 0.15.0 and `@anchor-lang/core` **1.2.0**, checked against the actual archived installation. Rust Anchor and the IDL CLI are separately pinned to **1.0.2**. Preserve lockfiles, cargo-build-sbf launcher 3.1.14, SBF tools 1.57 and arch v0.

```sh
export CYPERLINK_RESEARCH_ROOT=/Users/razvan/Repos/colosseum
python3 scripts/verify_research.py
python3 scripts/build_local.py --research-root "$CYPERLINK_RESEARCH_ROOT"
python3 scripts/prepare_local_replay.py --run-id consumers-01
```

The build command compiles all six implementation programs, builds the IDL and local client prover, and does not deploy. Runtime circuits are byte-pinned artifacts; this command does not rebuild them. The pinned toolchain emits known dependency/macro warnings; successful builds alone do not establish runtime correctness.

Preparation uses `target/deploy/{cyperlink_auth,ct_guard_spike,ct_policy_spike,cyperlink_merchant,cyperlink_license,cyperlink_proof_buffer}.so`, `programs/auth/target/idl/cyperlink_auth.json` and `programs/auth/build/runtime_budget_{init,bound}.{arcis,hash,idarc,weight}`. Its `--*-elf`, `--idl` and `--circuits` flags select explicit alternatives; there is no silent fallback to historical ELFs.

## Start and run

Preparation prints an application directory beneath the new `.local/replay-consumers-01` directory. From that application directory, run these in separate terminals:

```sh
python3 run-validator.py
```

```sh
docker compose -f artifacts/compose.json up -d --pull never
```

Run `examples/two-consumers/run.mjs` from the repository root with the printed application path, preparation manifest and a new output directory, as documented in its README. Use a separate fresh ledger for `conflict` and `compatible`; never reset quota between scenarios in the same ledger. The runner checks every actual loaded implementation ELF against the staged binary before provisioning and uses genuine native verification, owner signatures and signed runtime callbacks. A successful callback is authorization only; the SDK must observe the exact paid consumer effect and atomic quota/permit changes before reporting commit.

Preparation refuses an existing run directory, and the generated validator launcher refuses an existing ledger. It checks RPC/websocket ports8899/8900 and metrics ports9091/9092, with explicit override flags. These are point-in-time checks; another process can still claim a resource before startup.

Each run has its own Docker project, empty runtime share/log directories and an unused private /24. Only three reviewed public genesis IP fields are remapped: cluster dealer offset9 and node offsets72. Original values are checked and adaptations recorded in `preparation.json`. No existing network is changed. Recovery services using `latest` and the unused fixture URL bridge are omitted.

Disposable local administrator/node identities are copied into an ignored mode0700 directory with mode0600 files; new client signing/decryption keys remain there. JavaScript modules are linked read-only: do not install packages through that symlink. Public synthetic setup amounts and scenario observations are explicitly test-observer disclosures; no reusable account decryption key enters the MPC circuit.

## Evidence and shutdown

Keep `preparation.json`, source hashes, loaded ELF reports, signed transaction receipts, account snapshots and final scenario results together. Preparation hashes prove staging only. `scripts/verify_loaded_program.py --program-id ID --elf PATH --rpc http://127.0.0.1:8899 --output NEWFILE` checks actual loaded bytes, loader ownership and stable program pointer/genesis; it rejects nonzero trailing padding and public endpoints. The demo invokes it for all staged programs.

Costs remain separate: provisioning and native proof transactions, queue/callback transactions, final settlement CU/fees, and callback wall time. Worker CPU/network costs are not measured. Simulations, host tests, archived evidence and real committed transactions must remain separately labeled.

Stop only this run's containers from its application directory:

```sh
docker compose -f artifacts/compose.json down
```

Stop its validator with Ctrl-C in its own terminal. Preserve the ledger and evidence. Never reset the original ledger or use broad container/process stop commands.

## Historical fixture profiles

`--profile research-active161` stages the older fixture probe with historical quota key, blank quota expanded to161 bytes, canonical dynamic metadata and eighth queue metadata account. It requires matching explicitly selected historical implementation ELFs/IDL. `--profile research129` requires the original research ABI and programs. These profiles preserve synthetic native genesis assets and cannot establish fresh provisioning or the current canonical quota PDA path.

For those historical profiles only, run `node probe.cjs` and `node extra-checks.cjs` with `ANCHOR_PROVIDER_URL` and `ANCHOR_WALLET` pointing to the staged local run. `--admission-checks tests/local/admission-checks.cjs` adds signed negative queries before normal admission. Require `JOINED PROBE PASS` and inspect exact failure causes. The current default `provisioned161` deliberately disables that fixture probe; use the new example.

Completed results, interrupted attempts and remaining limitations are maintained in [STATUS.md](STATUS.md).
