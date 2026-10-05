#!/usr/bin/env python3
"""Install/check CyperLink's exact reviewed JavaScript dependency tree locally."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
from datetime import datetime, timezone

REPO = Path(__file__).resolve().parents[1]
CONFIG = REPO / 'config/local-js'
TARGET = REPO / '.local/toolchain/js'


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def load_config(config: Path = CONFIG):
    provenance = json.loads((config / 'provenance.json').read_text())
    for filename in ['package.json', 'package-lock.json']:
        require(sha256(config / filename) == provenance['files'][filename], f'Pinned {filename} provenance hash mismatch')
    package = json.loads((config / 'package.json').read_text())
    lock = json.loads((config / 'package-lock.json').read_text())
    require(lock['lockfileVersion'] == 3 and package['private'] is True, 'Unsupported dependency manifest')
    require(lock['packages']['']['dependencies'] == package['dependencies'] == provenance['direct_dependencies'], 'Root dependency pins disagree')
    require(len(lock['packages']) - 1 == provenance['retained_package_count'], 'Pinned package count mismatch')
    for name, version in package['dependencies'].items():
        require(re.fullmatch(r'\d+\.\d+\.\d+', version), f'Direct dependency {name} is not exact')
        require(lock['packages']['node_modules/' + name]['version'] == version, f'Root version differs for {name}')
    for path, record in lock['packages'].items():
        if not path:
            continue
        require(path.startswith('node_modules/') and '..' not in Path(path).parts and not Path(path).is_absolute(), 'Unsafe package path')
        require(record.get('resolved', '').startswith('https://registry.npmjs.org/'), f'Unexpected tarball source for {path}')
        require(record.get('integrity', '').startswith('sha512-'), f'Missing reviewed package integrity for {path}')
        require(not record.get('link') and not record.get('dev'), f'Unexpected linked or dev-only package {path}')
    return package, lock, provenance


def check_installed(target: Path, package, lock, provenance):
    require(target.resolve() == target, 'JS module root may not traverse symlinks')
    for filename in ['package.json', 'package-lock.json']:
        require(sha256(target / filename) == provenance['files'][filename], f'Staged {filename} differs from repository pin')
    modules = target / 'node_modules'
    require(modules.is_dir() and not modules.is_symlink(), 'Expected a real local node_modules directory')
    installed_lock = json.loads((modules / '.package-lock.json').read_text())
    require(not (set(installed_lock['packages']) - (set(lock['packages']) - {''})), 'Installed tree contains packages outside the pinned lock')
    missing_optional = []
    checked = 0
    for path, record in lock['packages'].items():
        if not path:
            continue
        installed = target / path
        if not installed.exists():
            require(record.get('optional') or record.get('devOptional'), f'Missing required package {path}')
            missing_optional.append(path)
            continue
        require(installed.resolve().is_relative_to(target), f'Package escapes local environment: {path}')
        metadata = json.loads((installed / 'package.json').read_text())
        require(metadata['version'] == record['version'], f'Installed version drift: {path}')
        actual = installed_lock['packages'].get(path)
        require(actual and actual.get('version') == record['version'] and actual.get('integrity') == record['integrity'], f'Installed lock integrity/version differs for {path}')
        checked += 1
    for name, version in package['dependencies'].items():
        require(json.loads((modules / name / 'package.json').read_text())['version'] == version, f'Missing exact direct dependency {name}')
    return {'checked_packages': checked, 'missing_optional_packages': missing_optional}


def ensure_private_destination(target=TARGET):
    require(target == TARGET, 'Only the repository-managed JS destination is supported')
    # Refuse writing through any preexisting symlink, including .local itself.
    for path in [REPO / '.local', REPO / '.local/toolchain', target]:
        require(not path.is_symlink(), f'Refusing symlink destination {path}')
        if path.exists():
            require(path.is_dir() and path.resolve() == path, f'Invalid local toolchain directory {path}')
        else:
            path.mkdir(mode=0o700)
    require(not (target / 'node_modules').is_symlink(), 'Refusing installation through a node_modules symlink')
    for filename in ['package.json', 'package-lock.json']:
        require(not (target / filename).is_symlink(), f'Refusing symlink manifest {filename}')
    if (target / 'node_modules').exists():
        require((target / 'installation.json').is_file() or (target / 'installation-pending.json').is_file(), 'Existing unmanaged node_modules: refuse to overwrite it')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Read-only installed-version and manifest verification')
    parser.add_argument('--offline', action='store_true', help='Require all npm tarballs already present in the local cache')
    parser.add_argument('--test', action='store_true', help='Run SDK, local-client and example host tests using this environment')
    args = parser.parse_args()
    package, lock, provenance = load_config()
    node = subprocess.check_output(['node', '--version'], text=True).strip().removeprefix('v')
    npm = subprocess.check_output(['npm', '--version'], text=True).strip()
    require(node == provenance['node'], f'Expected Node {provenance["node"]}, found {node}')
    require(npm == provenance['npm'], f'Expected npm {provenance["npm"]}, found {npm}')
    if not args.check:
        ensure_private_destination()
        for filename in ['package.json', 'package-lock.json']:
            shutil.copyfile(CONFIG / filename, TARGET / filename)
        # Pin the entire dependency resolution via npm ci. No registry resolution
        # command or lockfile update is permitted. Package lifecycle scripts are
        # disabled; runtime imports and behavior are checked separately.
        (TARGET / 'installation-pending.json').write_text(json.dumps({'package_lock_sha256': provenance['files']['package-lock.json']}) + '\n')
        command = ['npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund']
        if args.offline:
            command.append('--offline')
        environment = os.environ.copy()
        environment['npm_config_update_notifier'] = 'false'
        environment['npm_config_cache'] = str(REPO / '.local/toolchain/npm-cache')
        subprocess.run(command, cwd=TARGET, env=environment, check=True)
    checks = check_installed(TARGET, package, lock, provenance)
    # Exercise real package entrypoints, not just manifest version strings.
    smoke = """
const path = require('node:path');
const fs = require('node:fs');
const root = process.argv[1];
const localRequire = require('node:module').createRequire(path.join(root, 'package.json'));
for (const name of JSON.parse(process.argv[2])) {
  const loadedPath = fs.realpathSync(localRequire.resolve(name));
  if (!loadedPath.startsWith(root + path.sep + 'node_modules' + path.sep)) throw Error('Module escaped local environment: ' + name);
  localRequire(name);
}
"""
    subprocess.run(['node', '-e', smoke, str(TARGET), json.dumps(list(package['dependencies']))], check=True)
    report = {'schema_version': 1, 'module_root': str(TARGET), 'node': node, 'npm': npm,
              'package_lock_sha256': provenance['files']['package-lock.json'],
              'original_lock_sha256': provenance['original_lock_sha256'],
              'direct_dependencies': package['dependencies'], 'install_scripts_enabled': False, 'runtime_imports_passed': True,
              'verification': 'npm ci checks tarball integrity at install; this check verifies staged locks and installed package versions/integrities, not every extracted file',
              **checks}
    if not args.check:
        report['installed_at_utc'] = datetime.now(timezone.utc).isoformat()
        (TARGET / 'installation.json').write_text(json.dumps(report, indent=2) + '\n')
        (TARGET / 'installation-pending.json').unlink(missing_ok=True)
    if args.test:
        environment = os.environ.copy()
        environment['CYPERLINK_JS_MODULE_ROOT'] = str(TARGET)
        tests = sorted([*REPO.glob('packages/*/test/*.test.mjs'),
                        *REPO.glob('apps/*/*.test.mjs'), *REPO.glob('apps/*/test/*.test.mjs'),
                        *REPO.glob('examples/*/*.test.mjs'), *REPO.glob('examples/policies/qualification/*.test.mjs')])
        subprocess.run(['node', '--test', *(str(path) for path in tests)], cwd=REPO, env=environment, check=True)
        report['host_tests_passed'] = True
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError) as error:
        print(f'Local JavaScript setup failed: {error}', file=sys.stderr)
        sys.exit(1)
