# Pinned local toolchain

On the qualified Darwin arm64 host, run from this repository:

```sh
python3 scripts/setup_local_toolchain.py
python3 scripts/setup_local_toolchain.py --verify-only
```

The installer downloads the exact assets in `config/local-toolchain.json`, checks
their SHA-256 hashes, and installs below `.local/toolchain/native`. Download files
are cached by SHA-256 below `.local/toolchain/downloads`. Installed artifacts are
create-only. A later run reuses an installation only after checking its receipt
and file inventory; changed bytes fail rather than being overwritten. An existing
target without its verification receipt is refused. Downloads that fail their
hash check never become cached artifacts. There is no latest-version fallback.

`installation.json` in the native directory records absolute executable and
program paths, file hashes, CLI versions, public artifact retrieval evidence,
and cached Docker image checks. Consumers should use these explicit paths, not
the shell's unrelated global tools. The two Agave releases have different roles:
4.3.0 supplies the validator and key generator; 3.1.14 supplies the SBF launcher.
The SBF launcher reports its default platform-tools 1.52 when asked for its
version. Builds must explicitly request the qualified platform-tools v1.57 and
architecture v0. Host Rust 1.95.0 is also a separate prerequisite. This installer
does not install or change global Rust or SBF toolchains.

The launcher itself creates one runtime cache symlink at
`solana-release/bin/platform-tools-sdk/sbf/dependencies/platform-tools` when used.
That exact generated link is reported separately and excluded from the release
inventory only when it points at a `v1.57/platform-tools` directory. The installer
does not traverse or qualify that external cache; compilation must qualify the
actual SBF toolchain separately. All archived files remain hash checked.

The default setup can download the pinned native assets. Docker images are only
inspected locally unless `--pull-images` is supplied; that option permits pulling
only the two configured digest-pinned images. `--verify-only` performs no network
downloads or writes and cannot be combined with `--pull-images`.

Token-2022 and Lighthouse artifacts are retrieved from the fixed keyless mainnet
RPC using only `getGenesisHash`, `getAccountInfo`, and `getMultipleAccounts`.
Retrieval verifies the fixed mainnet genesis, executable/loader state, the
ProgramData pointer in a common account snapshot, and the entire payload's exact
pinned length and hash. ProgramData owner, discriminator, deployment slot, and
authority-option encoding are checked using the existing pure ELF comparison
helpers. The loopback-only loaded-program verifier is unchanged. An upstream
upgrade that changes these artifacts deliberately stops setup; it requires an
explicit new qualification instead of silently accepting different programs.

This is public, read-only artifact retrieval. It sends no transaction, simulates
no transaction, accesses no signer, and makes no claim that CyperLink ran on a
public network. The Arcium program artifacts come from the pinned official
binary URLs and must independently match their configured hashes.

Archive extraction rejects traversal, absolute paths, special files, duplicate
members, writes through links, and links leaving the fresh staging directory.
It preserves regular executable files and safe internal archive links, without
restoring archive ownership or privileged mode bits. Unit tests cover these
boundaries, corrupted cache/install bytes, missing receipts, public RPC method
restrictions, and public artifact identity failures.
