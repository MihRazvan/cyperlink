# Reproduction and evidence boundaries

The first reproducibility gate verifies the **archived final research bytes and
saved transaction records**. It does not execute the programs, reverify native
cryptographic proofs, contact RPC, reproduce compilation, or prove that a running
validator has those bytes loaded. Passing it must never be presented as a new
validator or distributed computation run.

From this repository, with Python 3.9 or newer:

```sh
python3 scripts/verify_research.py --research-root /path/to/colosseum
python3 -m unittest discover -s tests -p 'test_verify_research.py' -v
```

`CYPERLINK_RESEARCH_ROOT` can replace the explicit argument. The root is either
the original read-only research repository or the handoff's `research-snapshot`
directory, preserving the archived relative paths. No personal absolute path is
required. The script reads only the explicit root and this repository's checked-in
baseline manifest; it writes nothing and starts no services. Missing files fail
closed rather than silently lowering coverage.

`config/research-baseline.json` pins 46 files (4,594,680 bytes), including the
original provenance manifest itself, all 38 entries in that manifest, and seven
additional circuit/dependency/runtime configuration files. These pins include
the final auth source, ELF, IDL, Cargo lockfiles, circuit outputs, JavaScript lockfile,
Docker digest configuration, native programs, and independent saved review.
The provenance manifest is historical evidence, not a generated manifest of
whatever files happen to exist today.

The verifier checks the archived joined and extra-check success records, three
denied input-mismatch callbacks, six signed native proof transaction receipts,
the native settlement receipt, final quota version 1/counter 6, and consistency
between the saved loaded-ELF review and the pinned ELF/source. Receipt checks
compare saved RPC transaction signatures and errors; they do not independently
reverify signatures or query an active node. The recorded loaded-ELF check is
likewise a pinned review record, not a new ProgramData fetch.

The final auth ELF is 573,232 bytes, SHA256
`cedff4962f7de61e8e733f8ffa23d3da3433bd2eb8d750fa9027ee42c2b782a0`.
The runtime amount-bound circuit SHA256 is
`eaad70f272e3d1f9405a92755cbb7140bb066bf048bf81752c7c51c74a7ac085`.
The earlier `pre-type-check` execution is excluded. Any substantive source change
requires new evidence; passing these historical checks cannot qualify new code.

## Pinned execution profile

Use Agave 4.3.0, solana-zk-sdk 7.0.1, Arcium 0.15.0, Anchor 1.0.2,
Token-2022 interface 3.1.0, and queue proof interface 0.1.3. Joined validator
programs use SBF tools 1.57 with `--arch v0`; earlier local SVM artifacts used a
different architecture. Preserve exact dependency lockfiles. Some historical
package manifests contain semver ranges; installing those without their
lockfiles is not a pinned replay. The Docker Compose file pins runtime images
by digest, but still needs isolated network and local identity configuration.

The initial profile is synthetic local assets, one quota/MXE, administrator
co-signing, no transfer-fee extension, the configured transfer hook and CPI Guard
disabled. AUSD needs its own fee-aware adapter even at zero basis points.
Account-wide native decryption keys stay client-side. Test-observer quota or
balance disclosures are synthetic test observations, not public protocol output.

## Next execution gates

1. Copy only required sources/configuration into an isolated new run directory;
   preserve the original evidence and fixtures. Resolve historical absolute
   paths and create a fresh consistent set of disposable keys, proofs, witnesses,
   account addresses and action hashes. Never mix regenerated proof randomness
   with old witnesses or receipts.
2. Build reviewed source using pinned lockfiles and tools; preserve build logs,
   source/ELF/IDL/circuit hashes and compiler versions. Runtime circuits must use
   managed client/MXE keys. Explicit fixture-key mocks are a separate test tier.
3. Start a fresh local ledger and uniquely named two-node Compose project, with
   isolated ports/networks and outputs. Do not reset original ledgers or stop
   unrelated services. Submit real owner-signed proof verification and operation
   transactions; never stage an authorized permit or inject a verified context.
4. Fetch the active program and ProgramData, decode the upgradeable loader header,
   compare deployed ELF bytes with the exact build, and record any zero padding.
   Confirm successful callback transactions for the exact computation rather
   than accepting an SDK helper's possibly failed duplicate signature.
5. Capture fresh transaction/account evidence and adversarial failures. Report
   mock, local SVM, real local validator, two-node computation, and public-network
   evidence separately, including costs. The initial work authorizes no
   public-network writes or production deployment.

The research's grouped amount binding is established, but complete native
proof/account/funding validation **before policy disclosure** and authorized-query
semantics remain implementation work. Archived hashes do not close that gap.
Only the merchant consumer joined the final live admission flow; two reference
consumers alone do not establish a fully authenticated two-consumer demo.

The source handoff's `04-REPRODUCTION-RUNBOOK.md` and
`06-ARTIFACTS-AND-TRANSFER.md` contain historical replay commands and artifact
locations. They explicitly do not claim a turnkey clean-machine replay.
