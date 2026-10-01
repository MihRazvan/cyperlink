#!/usr/bin/env python3
"""Generate fresh pinned Arcium localnet state, intercepting every service launch.

The upstream CLI has no generation-only mode. Its pinned `test` preparation is
allowed to create local files; a fail-closed PATH wrapper ends execution before
Anchor can launch a validator. This is bootstrap generation, not runtime proof.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

REPO = Path(__file__).resolve().parents[1]
PINS = REPO / 'config/runtime-generation.json'
B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'


def sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def pubkey(raw):
    n = int.from_bytes(raw, 'big')
    out = ''
    while n:
        n, v = divmod(n, 58)
        out = B58[v] + out
    return '1' * (len(raw) - len(raw.lstrip(b'\0'))) + out


def checked_file(path, expected):
    path = Path(path).resolve(strict=True)
    if not path.is_file() or sha256(path) not in expected:
        raise ValueError(f'Unqualified artifact bytes: {path}')
    return path


def require_new_local_output(path):
    path = Path(os.path.abspath(path))
    local = REPO / '.local'
    if path != path.resolve() or local != local.resolve():
        raise ValueError('Output must remain beneath the repository without symlink components')
    if not path.is_relative_to(local) or path == local:
        raise ValueError('Output must be a new directory beneath this repository .local/')
    if path.exists():
        raise ValueError('Output already exists; refuse key/state reuse or overwrite')
    subprocess.run(['git', 'check-ignore', '-q', str(path / 'local-test-wallet.json')], cwd=REPO, check=True)
    return path


def write_wrappers(directory):
    directory.mkdir(mode=0o700)
    source = '''#!/usr/bin/env python3
import json, pathlib, sys
name = pathlib.Path(sys.argv[0]).name
args = sys.argv[1:]
root = pathlib.Path(__file__).resolve().parent.parent
with (root / 'intercepted.jsonl').open('a') as f:
    f.write(json.dumps({'command': name, 'args': args}) + '\\n')
versions = {'anchor': 'anchor-cli 1.0.2', 'solana-test-validator': 'solana-test-validator 4.3.0', 'docker': 'Docker version 28.0.0', 'solana': 'solana-cli 4.3.0'}
if args == ['--version'] and name in versions:
    print(versions[name]); sys.exit(0)
if name == 'docker' and args in [['compose', 'version'], ['info']]:
    print('Docker Compose version v2.39.1' if args[0] == 'compose' else 'Generation wrapper; no daemon accessed')
    sys.exit(0)
if name == 'anchor' and args == ['localnet', '--skip-build', '--validator', 'legacy']:
    (root / 'launch-intercepted.json').write_text(json.dumps({'command': name, 'args': args, 'exit': 77}) + '\\n')
print('CYPERLINK_GENERATION_STOP ' + name, file=sys.stderr)
sys.exit(77)
'''
    for name in ['anchor', 'solana-test-validator', 'solana', 'docker', 'pkill', 'killall', 'surfpool']:
        target = directory / name
        target.write_text(source)
        target.chmod(0o700)


def validate_interceptions(out):
    marker = json.loads((out / 'launch-intercepted.json').read_text())
    if marker != {'command': 'anchor', 'args': ['localnet', '--skip-build', '--validator', 'legacy'], 'exit': 77}:
        raise ValueError('Unexpected launch boundary')
    calls = [json.loads(line) for line in (out / 'intercepted.jsonl').read_text().splitlines()]
    allowed = [(name, ['--version']) for name in ['anchor', 'solana-test-validator', 'docker']]
    allowed += [('docker', ['compose', 'version']), ('docker', ['info']),
                ('anchor', ['localnet', '--skip-build', '--validator', 'legacy']),
                ('docker', ['compose', '-f', 'artifacts/docker-compose-arx-env.yml', 'down', '--remove-orphans'])]
    for call in calls:
        if (call['command'], call['args']) not in allowed:
            raise ValueError(f'Unexpected blocked subprocess: {call}')
    return calls


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['arcium', 'solana-keygen', 'arcium-elf', 'staking-elf', 'lighthouse-elf', 'out']:
        parser.add_argument('--' + name, type=Path, required=True)
    args = parser.parse_args()
    pins = json.loads(PINS.read_text())
    cli = checked_file(args.arcium, pins['arcium_cli_sha256'])
    elfs = {kind: checked_file(getattr(args, kind + '_elf'), [pins['elf_sha256'][kind]])
            for kind in ['arcium', 'staking', 'lighthouse']}
    keygen = checked_file(args.solana_keygen, pins['solana_keygen_sha256'])
    out = require_new_local_output(args.out)
    os.umask(0o077)
    out.mkdir(parents=True, mode=0o700)
    artifacts = out / 'artifacts'
    artifacts.mkdir(mode=0o700)
    for kind, filename in [('arcium', 'arcium_program_0.15.0.so'), ('staking', 'arcium_staking_program_0.15.0.so'), ('lighthouse', 'lighthouse.so')]:
        shutil.copyfile(elfs[kind], artifacts / filename)
    env = dict(os.environ)
    env.update(ARCIUM_NO_UPDATE_CHECK='1', CI='1')
    # Explicit output, fresh entropy, and no configured wallet or RPC access.
    subprocess.run([str(keygen), 'new', '--no-bip39-passphrase', '--silent', '--outfile', str(out / 'local-test-wallet.json')],
                   env=env, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    wallet = json.loads((out / 'local-test-wallet.json').read_text())
    if len(wallet) != 64 or any(type(v) is not int or v < 0 or v > 255 for v in wallet):
        raise ValueError('Generated wallet does not have Solana keypair format')
    payer = pubkey(bytes(wallet[32:]))
    del wallet
    (out / 'Anchor.toml').write_text(f'''[toolchain]
package_manager = "npm"
[features]
resolution = true
skip-lint = false
[programs.localnet]
cyperlink_auth = "{pins['auth_program']}"
[provider]
cluster = "localnet"
wallet = "./local-test-wallet.json"
[scripts]
test = "true"
[test.validator]
startup_wait = 10000
''')
    (out / 'Arcium.toml').write_text('[localnet]\nnodes = 2\nnodes_ips = [[172, 20, 0, 100], [172, 20, 0, 101]]\nlocalnet_timeout_secs = 1\n')
    (out / 'Cargo.toml').write_text('[workspace]\nmembers = []\nresolver = "2"\n')
    write_wrappers(out / 'generation-bin')
    env['PATH'] = str(out / 'generation-bin') + os.pathsep + env['PATH']
    command = [str(cli), 'test', '--skip-build', '--skip-local-arx-nodes', '--skip-local-circuit',
               '--override-program-path', str(artifacts / 'arcium_program_0.15.0.so'),
               '--override-staking-path', str(artifacts / 'arcium_staking_program_0.15.0.so'),
               '--validator', 'legacy', '--offset', '0', '--number-of-arx-nodes', '2']
    with (out / 'generation.log').open('w') as log:
        result = subprocess.run(command, cwd=out, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=45)
    calls = validate_interceptions(out)
    if result.returncode != 1:
        raise ValueError('Expected pinned CLI to report intercepted startup failure')
    account_paths = sorted(artifacts.glob('*.json'))
    records, genesis, seen = [], [], set()
    for path in account_paths:
        obj = json.loads(path.read_text())
        if set(obj) != {'pubkey', 'account'} or obj['pubkey'] in seen:
            raise ValueError(f'Unexpected or duplicate genesis document: {path.name}')
        seen.add(obj['pubkey'])
        account = obj['account']
        if account['data'][1] != 'base64':
            raise ValueError('Unknown account encoding')
        raw = base64.b64decode(account['data'][0], validate=True)
        records.append({'path': str(path), 'pubkey': obj['pubkey'], 'owner': account['owner'], 'data_bytes': len(raw), 'sha256': sha256(path)})
        genesis += ['--account', obj['pubkey'], str(path)]
    if len(records) != 60 or not all((artifacts / name).is_file() for name in
                                   ['mxe_acc.json', 'cluster_acc_0.json', 'node_config_0.toml', 'node_config_1.toml', 'trusted_dealer_config.toml', 'docker-compose-arx-env.yml']):
        raise ValueError('Pinned generation schema drifted')
    if list(artifacts.glob('backup*')) or (artifacts / 'localnet/mxe_utility_pubkeys.bin').exists():
        raise ValueError('Unexpected backup cluster or cached MXE keys')
    for i in range(2):
        for filename in [f'node_{i}.json', f'node_callback_{i}.json', f'node_bls_{i}.json', f'node_x25519_{i}.json', f'identity_{i}.pem']:
            if not (artifacts / 'localnet' / filename).is_file():
                raise ValueError('Fresh node key material missing')
    (out / 'genesis-args.json').write_text(json.dumps(genesis, indent=2) + '\n')
    report = {'schema': 1, 'scope': 'fresh upstream localnet genesis generation only; no validator or MPC execution',
              'out': str(out), 'artifacts': str(artifacts), 'payer': payer, 'auth_program': pins['auth_program'],
              'cluster_offset': 0, 'nodes': 2, 'recovery_identity_count': 8, 'cached_mxe_keys': False,
              'arcium_version': pins['arcium_version'], 'arcium_cli_sha256': sha256(cli),
              'keygen_sha256': sha256(keygen), 'elf_sha256': pins['elf_sha256'],
              'genesis_accounts': records, 'intercepted_subprocesses': calls, 'limitations': pins['limitations']}
    (out / 'generation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({'out': str(out), 'payer': payer, 'genesis_accounts': len(records), 'service_launch_intercepted': True}))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, subprocess.SubprocessError) as error:
        print(f'Runtime generation failed: {error}', file=sys.stderr)
        sys.exit(1)
