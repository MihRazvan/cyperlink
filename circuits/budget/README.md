# Rebuild the deployed runtime circuits

This host compiler produces both circuits used by the authenticated local demo:
`runtime_budget_init` initializes the allowance under the real MXE key, and
`runtime_budget_bound` checks the queue-authenticated native amount commitment
before revealing the policy decision and encrypted successor. Neither circuit
accepts an account decryption key, MXE private key, or fixture Rescue key.

From the repository root:

```sh
python3 scripts/rebuild_circuits.py --out .local/circuit-rebuild-01
python3 -m unittest discover -s tests -p test_rebuild_circuits.py
```

The output directory must be new and below repository `.local`. The script copies
only source, `Cargo.toml`, and `Cargo.lock` there, then runs `cargo run --locked
--offline`. It never copies circuit outputs or compiler cache markers into the
staging crate. Rust dependency object files may be reused from the local
`.local/circuit-build-target` cache; both circuit IRs and artifacts are generated
anew. On a machine without the pinned crates cached, `--allow-network` permits
Cargo to download the locked versions. It does not update dependencies.

Compilation uses the published `arcis-compiler = 0.15.0` Rust API with its
`internals` feature and `arcis-interface = 0.15.0`; it does not need a separate
Arcium CLI. The existing lockfile and all direct dependency pins are unchanged.
The report records the actual Rust/Cargo versions and source hashes. The first
fresh rebuild in this repository used Homebrew Rust/Cargo 1.92.0.

The [October 1 rebuild report](../../evidence/2026-10-01/circuit-source-rebuild.json)
records a successful fresh compilation and exact comparison of all eight files.
The dependency build and both circuit compilations together took 59.337 seconds
on that host. Six host integrity tests cover corruption, missing artifacts,
inconsistent native hashes, and accidental reuse of staged compiler outputs.

The script first verifies the eight reviewed artifacts in `programs/auth/build`
against `baseline.json`. After compilation it compares every `.arcis`, `.hash`,
`.idarc`, and `.weight` file against both the pinned hashes and the exact reviewed
bytes. Each native `.hash` must also encode the SHA-256 of its `.arcis`. A missing
initializer, a changed byte, or a changed lockfile fails the command. The staging
directory retains `compile.log`, generated IR and runtime metadata, and
`report.json` including failure details if compilation or comparison fails.

## Source provenance

The bound circuit was previously imported from the reviewed
`research/cyperlink-prebuild-2026-10-01/admission-review/bound-circuit` experiment.
This slice adds a call to the initializer and imports its complete
`compile_initializer` function verbatim from
`research/cyperlink-probes-2026-10-01/auth-review/runtime-key-circuit/src/main.rs`.
`baseline.json` records the original initializer source and extracted function
hashes. The older `runtime_budget_link` circuit from that experiment is not
imported or built. The initializer's dependency versions are the same versions
already present in this crate's reviewed bound-circuit lockfile.

Initializer owner authorization and initialize-once enforcement belong to the
onchain admission/callback path. Circuit byte equality proves reproducible host
compilation, not a fresh distributed computation, loaded Solana ELF validation,
or public-network execution. The compiler `.weight` values are modeled costs;
host elapsed build time is reported separately from any demo transaction fees
or callback latency. This command does not modify deployed artifacts, original
research, a validator, or the replay bootstrap.
