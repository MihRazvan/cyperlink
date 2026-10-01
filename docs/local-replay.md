# Isolated same-machine local replay

`scripts/prepare_local_replay.py` stages the final historical joined harness against selected implementation ELFs and IDL. Preparation starts no services and makes no writes to the research checkout. This remains a synthetic fixture replay: it does not provision new native confidential accounts, demonstrate a production key lifecycle or authenticate the second reference consumer.

Prerequisites are the original same-machine research tree, its pinned Agave 4.3.0 executable and installed JavaScript dependencies, Docker with the cached digest-pinned Arcium images, and freshly built implementation programs. No image pulls are performed. The exact installed research JavaScript versions are `@arcium-hq/client` 0.15.0 and `@anchor-lang/core` **1.2.0**, as recorded by the archived `package-lock.json`; Anchor Rust/IDL build tooling is separately pinned to 1.0.2. The historical package manifest's `^1.0.2` is not proof that its JavaScript installation was 1.0.2.

From the repository root:

```sh
python3 scripts/prepare_local_replay.py --run-id admission-01
```

Default build inputs are `target/deploy/{cyperlink_auth,ct_guard_spike,ct_policy_spike,cyperlink_merchant}.so`, `programs/auth/target/idl/cyperlink_auth.json`, and `programs/auth/build/runtime_budget_{init,bound}.{arcis,hash,idarc,weight}`. Override with `--auth-elf`, `--guard-elf`, `--policy-elf`, `--merchant-elf`, `--idl` and `--circuits` when needed. Historical-baseline replay must select the historical auth build explicitly; the script never silently falls back to an old ELF.

Pass `--research-root PATH` or set `CYPERLINK_RESEARCH_ROOT` to relocate the read-only research dependency. `--admission-checks tests/local/admission-checks.cjs` optionally stages an additional signed-negative test module and invokes it after real native proofs and encrypted quota initialization, before the original operation queues. The module receives the live program/client and probe helpers. Neither it nor preparation creates verified contexts or authorized permits.

The script creates a new ignored `.local/replay-<run-id>` directory with mode 0700, copies only the selected public genesis/artifacts and disposable local signing/node secrets (files mode 0600), and creates empty runtime share/input/log directories. The dependency tree is referenced by a symlink for read-only module loading; do not run package installation through that symlink. The validator executable is also read from the original installation. This is intentionally not a clean-machine bootstrap.

All 86 genesis accounts are preserved except three reviewed public IPv4 address fields: the cluster dealer address at offset 9 and the two node addresses at offset 72. They are remapped together with Compose onto a currently unused private /24; the original bytes and offsets are checked before editing and recorded in `preparation.json`. No existing Docker network is changed. Recovery services using `latest` and the unused URL-fixture bridge are omitted. Only the two digest-pinned runtime nodes and trusted dealer are configured. Runtime state is fresh; disposable identities and the synthetic native fixture remain the historical identities. Historical preallocated permit accounts are empty and still require authenticated callbacks to admit them.

The command checks the RPC/websocket pair (8899/8900 by default) and metrics pair (9091/9092) before preparing. Override with `--rpc-port` or `--metrics-port` if occupied. This is a point-in-time check; another process could claim a port/subnet before startup. Preparation refuses an existing run directory, and the generated validator launcher refuses an existing ledger.

Use the printed application directory for the following commands. In separate terminals:

```sh
python3 run-validator.py
```

```sh
docker compose -f artifacts/compose.json up -d --pull never
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=./local-test-wallet.json node probe.cjs
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 ANCHOR_WALLET=./local-test-wallet.json node extra-checks.cjs
```

Use the printed RPC port in both environment variables when overridden. Each generated Compose file has its own project name. The staged probe writes only inside its replay directory. It uses real native proof verification and owner signatures, runtime MXE keys and authenticated callbacks. Require `JOINED PROBE PASS`, successful extra checks, and review the actual failure causes; an expected failure by itself does not establish the intended invariant. Preserve all resulting transaction/account records.

Before claiming execution of changed source, dump every changed loaded program through the local RPC and compare it byte-for-byte with its staged ELF. For example, with the pinned Agave `solana` executable:

```sh
/path/to/pinned/solana --url http://127.0.0.1:8899 program dump 5bgSoi3WbUndQNhWrkxJoURjkRd28BxxucZozwGR9AQQ loaded-auth.so
cmp target/deploy/cyperlink_auth.so loaded-auth.so
```

Record the loaded ELF hash and current source/build inputs with the new evidence. `preparation.json` records staged hashes, network adaptations and selected deployment inputs; these are preparation provenance, not proof of loaded bytes or successful execution. It deliberately omits hashes and contents of copied secrets. Synthetic plaintext fixtures and any decoded private test state are test-observer disclosures.

Stop only this run's services:

```sh
docker compose -f artifacts/compose.json down
```

Stop its validator with Ctrl-C in the terminal that launched it. Preserve the ledger and evidence; prepare a new run ID for the next replay. Never reset the original research ledger or use broad container/process stop commands.

Preparation validation performed on 2026-10-01: isolated mounts, three static peer IP rewrites, empty runtime directories, secret permissions, 86 genesis accounts, installed module resolution and matching disposable owner public keys passed. This validation did not start the validator or distributed computation. New live results must be recorded separately in `STATUS.md`.
