# Repository-managed local JavaScript runtime

This package supplies the pinned JavaScript runtime for Console, policy tooling and the local client. Its four direct dependencies match the qualified research versions:

| Package | Exact version |
|---|---|
| `@solana/web3.js` | 1.99.0 |
| `@anchor-lang/core` | 1.2.0 |
| `@arcium-hq/client` | 0.15.0 |
| `bn.js` | 5.2.5 |

`package-lock.json` retains all 67 non-dev package records from the archived research lock, with their original versions, tarball URLs, integrity checksums and dependency metadata unchanged. Optional peer/tool entries are retained. Only the root manifest was replaced with exact direct pins and dev-only entries were removed. No dependency resolver or version upgrade produced this lock. In particular, the original Anchor manifest's `^1.0.2` resolves to the tested JavaScript **1.2.0**; Rust/IDL Anchor1.0.2 remains separate.

`provenance.json` records the original lock path/hash, extraction rule, retained count and repository manifest hashes. The original research lock SHA256 is `b4f75537d61d0cd2c7a3e9dcec12753d3676845d3f9868413350a1ce7f7eedec`; the derived lock SHA256 is `b88a51932a871d24d2a9a4cdf97a2b407b0917531db9b1bc113c3fddf6fc4f6d`. Bootstrap needs only these repository files and public npm tarballs, not the research checkout.

From the repository root, with Node24.12.0 and npm11.6.2 available:

```sh
python3 scripts/setup_local_js.py --test
```

The script copies the frozen manifest/lock to `.local/toolchain/js` and runs `npm ci --ignore-scripts --no-audit --no-fund`. Package lifecycle scripts never execute. npm's tarball integrity checking remains enabled; dependency versions are not upgraded. Cache and logs stay under `.local/toolchain/npm-cache`. The script refuses symlink destinations and existing dependency trees it did not provision, so it cannot install through a research `node_modules` symlink. A interrupted managed install can be retried using the same command.

Node24.12.0 is the recorded research host version. npm11.6.2 is the exact installer inspected and qualified for this bootstrap. Both are checked before installation; this script does not install or upgrade Node/npm. `--offline` requires the same tarballs already present in this repository's local cache.

Use the generated **package root**, not its `node_modules` child:

```sh
CYPERLINK_JS_MODULE_ROOT="$PWD/.local/toolchain/js" node --test packages/local-client/test/runtime.test.mjs
```

The local provisioning commands take the same `--module-root`; deployment records it
in the instance consumed by Console. `--check` performs installed verification without
installing or replacing anything. `--test` runs the maintained SDK, policy CLI/client,
local-client, Console and reference-example host suites:

```sh
python3 scripts/setup_local_js.py --check --test
python3 -m unittest discover -s tests -p test_setup_local_js.py -v
```

Verification compares repository/staged manifest hashes, all installed package versions and installed lock integrity values, rejects packages outside the frozen lock, and imports all four runtime entrypoints from the new module root. Optional packages absent on a platform are reported explicitly; required packages must exist. It does not rehash every extracted package file or claim an independent package security audit.

Qualification on 2026-10-01: a fresh `npm ci` installed all67 packages, all four runtime imports succeeded, and all25 SDK/local-client/example host tests passed using the repository-managed environment. Seven bootstrap tests cover manifest tampering, version/integrity drift, unknown packages, symlink escapes and unmanaged-tree overwrite refusal. These are dependency and host-test results, not a new validator or distributed demo execution.
