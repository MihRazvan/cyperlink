#!/usr/bin/env python3
"""Build the pinned local programs, IDL and client prover; never deploy."""
import argparse
import os
import json
import hashlib
from pathlib import Path
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--research-root', type=Path, default=os.environ.get('CYPERLINK_RESEARCH_ROOT'))
    parser.add_argument('--toolchain', type=Path, help='Repository-local native installation from setup_local_toolchain.py')
    parser.add_argument('--anchor', type=Path, help='Pinned Anchor CLI 1.0.2 binary')
    args = parser.parse_args()
    anchor = args.anchor
    installed = None
    if args.toolchain:
        root = args.toolchain.resolve(strict=True)
        if not root.is_relative_to(ROOT / '.local'):
            parser.error('Toolchain must be beneath repository .local')
        pins = json.loads((ROOT / 'config/local-toolchain.json').read_text())
        installed = json.loads((root / 'installation.json').read_text())['executables']
        for name in ['anchor', 'sbf']:
            path = Path(installed[name]['path'])
            if not path.is_absolute(): path = root / path
            if not path.resolve().is_relative_to(root) or hashlib.sha256(path.read_bytes()).hexdigest() != installed[name]['sha256']:
                parser.error('Installed build executable changed: ' + name)
            if hashlib.sha256(path.read_bytes()).hexdigest() != pins['executables'][name]['sha256']:
                parser.error('Build executable differs from repository pin: ' + name)
            installed[name]['path'] = str(path)
        if anchor is None: anchor = Path(installed['anchor']['path'])
    if anchor is None:
        if args.research_root is None:
            parser.error('Provide --anchor or --research-root / CYPERLINK_RESEARCH_ROOT')
        anchor = args.research_root / 'research/cyperlink-probes-2026-10-01/authenticated/bin/anchor'
    anchor = anchor.resolve(strict=True)
    if installed and hashlib.sha256(anchor.read_bytes()).hexdigest() != pins['executables']['anchor']['sha256']:
        parser.error('Anchor override differs from repository pin')
    env = os.environ.copy()
    env['PATH'] = str(Path.home() / '.cargo/bin') + os.pathsep + env['PATH']
    if installed:
        for cwd, version in [(ROOT, pins['host_rust']), (ROOT / 'programs/auth', pins['auth_workspace_rust'])]:
            for command in ['rustc', 'cargo']:
                actual = subprocess.check_output([command, '--version'], cwd=cwd, env=env, text=True).split()[1]
                if actual != version:
                    parser.error(f'Expected {command} {version} in {cwd}, found {actual}')
    sbf = installed['sbf']['path'] if installed else shutil.which('cargo-build-sbf', path=env['PATH'])
    if sbf is None:
        parser.error('Install the recorded cargo-build-sbf launcher 3.1.14 first')
    if subprocess.check_output([sbf, '--version'], text=True, env=env).splitlines()[0].strip() != 'solana-cargo-build-sbf 3.1.14':
        parser.error('Expected recorded cargo-build-sbf launcher 3.1.14 (SBF tools are separately pinned to1.57)')
    if subprocess.check_output([str(anchor), '--version'], text=True, env=env).strip() != 'anchor-cli 1.0.2':
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
