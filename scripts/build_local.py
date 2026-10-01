#!/usr/bin/env python3
"""Build the pinned local programs, IDL and client prover; never deploy."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--research-root', type=Path, default=os.environ.get('CYPERLINK_RESEARCH_ROOT'))
    parser.add_argument('--anchor', type=Path, help='Pinned Anchor CLI 1.0.2 binary')
    args = parser.parse_args()
    anchor = args.anchor
    if anchor is None:
        if args.research_root is None:
            parser.error('Provide --anchor or --research-root / CYPERLINK_RESEARCH_ROOT')
        anchor = args.research_root / 'research/cyperlink-probes-2026-10-01/authenticated/bin/anchor'
    anchor = anchor.resolve(strict=True)
    env = os.environ.copy()
    env['PATH'] = str(Path.home() / '.cargo/bin') + os.pathsep + env['PATH']
    sbf = shutil.which('cargo-build-sbf', path=env['PATH'])
    if sbf is None:
        parser.error('Install the recorded cargo-build-sbf launcher 3.1.14 first')
    if '3.1.14' not in subprocess.check_output([sbf, '--version'], text=True, env=env):
        parser.error('Expected recorded cargo-build-sbf launcher 3.1.14 (SBF tools are separately pinned to1.57)')
    if '1.0.2' not in subprocess.check_output([str(anchor), '--version'], text=True, env=env):
        parser.error('Expected Anchor CLI 1.0.2')
    (ROOT / 'target/deploy').mkdir(parents=True, exist_ok=True)
    for manifest in ['programs/native/Cargo.toml', 'programs/auth/programs/cyperlink_auth/Cargo.toml']:
        subprocess.run([sbf, '--manifest-path', manifest, '--tools-version', 'v1.57', '--arch', 'v0',
                        '--sbf-out-dir', str(ROOT / 'target/deploy'), '--offline', '--', '--locked'],
                       cwd=ROOT, env=env, check=True)
    for folder in ['target/idl', 'target/types']:
        (ROOT / 'programs/auth' / folder).mkdir(parents=True, exist_ok=True)
    subprocess.run([str(anchor), 'idl', 'build', '-p', 'cyperlink_auth', '-o', 'target/idl/cyperlink_auth.json',
                    '-t', 'target/types/cyperlink_auth.ts'], cwd=ROOT / 'programs/auth', env=env, check=True)
    subprocess.run(['cargo', 'build', '--locked', '--offline', '--manifest-path', 'crates/client-proofs/Cargo.toml'],
                   cwd=ROOT, env=env, check=True)
    print('Built programs, IDL and client prover. Runtime circuits are pinned artifacts; no deployment or execution claimed.')


if __name__ == '__main__':
    main()
