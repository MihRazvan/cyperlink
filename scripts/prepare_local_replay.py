#!/usr/bin/env python3
"""Prepare (never start) an isolated same-machine replay of the joined research."""
from __future__ import annotations

import argparse
import base64
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
from datetime import datetime, timezone

REPO = Path(__file__).resolve().parents[1]
PREBUILD = Path('research/cyperlink-prebuild-2026-10-01')
APP = PREBUILD / 'bound-join/cyperlink_auth'
PROGRAMS = {
    'auth': ('5bgSoi3WbUndQNhWrkxJoURjkRd28BxxucZozwGR9AQQ', 'cyperlink_auth.so'),
    'guard': ('6URwbPipuA4MJLG7LCRRZuWnms3JZ9cRG3z9indXWz8G', 'ct_guard_spike.so'),
    'policy': ('6YMEjhBqVTMaSRWcmVkLrnHZ22FWEDJEpTeonAg8GKSy', 'ct_policy_spike.so'),
    'merchant': ('6cGXszer5keoaWm8Co5G9f4KGBThuGz4NsKTqYij1emg', 'cyperlink_merchant.so'),
}


def run_json(*args):
    return json.loads(subprocess.check_output(args, text=True, stderr=subprocess.PIPE))


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def available_port(port):
    with socket.socket() as sock:
        try:
            sock.bind(('127.0.0.1', port))
        except OSError as error:
            raise RuntimeError(f'Local TCP port {port} is occupied; select another port') from error


def choose_subnet(requested):
    names = subprocess.check_output(['docker', 'network', 'ls', '-q'], text=True).split()
    networks = run_json('docker', 'network', 'inspect', *names) if names else []
    occupied = [ipaddress.ip_network(c['Subnet']) for n in networks
                for c in (n.get('IPAM', {}).get('Config') or []) if c.get('Subnet')]
    candidates = [ipaddress.ip_network(requested)] if requested else [
        ipaddress.ip_network(f'172.{second}.{third}.0/24')
        for second in range(28, 32) for third in range(256)]
    for candidate in candidates:
        if candidate.version != 4 or candidate.prefixlen != 24 or not candidate.is_private:
            raise RuntimeError('Replay subnet must be a private IPv4 /24')
        if not any(candidate.overlaps(other) for other in occupied if other.version == 4):
            return candidate
    raise RuntimeError('Requested subnet overlaps an existing Docker network')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--research-root', type=Path, default=Path(os.environ.get(
        'CYPERLINK_RESEARCH_ROOT', '/Users/razvan/Repos/colosseum')))
    parser.add_argument('--run-id', default=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
    for kind, (_, filename) in PROGRAMS.items():
        parser.add_argument(f'--{kind}-elf', type=Path, default=REPO / 'target/deploy' / filename)
    parser.add_argument('--idl', type=Path, default=REPO / 'programs/auth/target/idl/cyperlink_auth.json')
    parser.add_argument('--circuits', type=Path, default=REPO / 'programs/auth/build')
    parser.add_argument('--rpc-port', type=int, default=8899)
    parser.add_argument('--metrics-port', type=int, default=9091, help='First of two consecutive ports')
    parser.add_argument('--admission-checks', type=Path, help='Optional signed-negative test module, inserted after real proofs and quota initialization')
    parser.add_argument('--subnet', help='Unused private IPv4 /24; automatically chosen by default')
    args = parser.parse_args()
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9_-]{0,48}', args.run_id):
        parser.error('run-id must contain 1–49 letters, numbers, underscores or hyphens')
    research = args.research_root.resolve()
    original = research / APP
    destination = REPO / '.local' / f'replay-{args.run_id}'
    if destination.exists():
        raise RuntimeError('Run directory exists; choose a new run-id (no reset or overwrite)')
    # Secret storage must be ignored before anything is copied.
    subprocess.run(['git', 'check-ignore', '-q', str(destination / 'local-test-wallet.json')],
                   cwd=REPO, check=True)
    ports = [args.rpc_port, args.rpc_port + 1, args.metrics_port, args.metrics_port + 1]
    if len(set(ports)) != 4 or not all(1024 <= p <= 65535 for p in ports):
        raise RuntimeError('RPC/websocket and metrics ports must be four distinct unprivileged ports')
    for port in ports:
        available_port(port)
    subnet = choose_subnet(args.subnet)
    compose = run_json('docker', 'compose', '-f', str(original / 'artifacts/docker-compose-arx-env.yml'),
                       'config', '--format', 'json')
    selected = ['arcium-trusted-dealer', 'arx-node-0', 'arx-node-1']
    services = {name: compose['services'][name] for name in selected}
    for name, service in services.items():
        if '@sha256:' not in service['image']:
            raise RuntimeError(f'Unpinned image for {name}')
    modules = (original / 'node_modules').resolve(strict=True)
    for package, version in [('@arcium-hq/client', '0.15.0'), ('@anchor-lang/core', '1.2.0')]:
        if json.loads((modules / package / 'package.json').read_text())['version'] != version:
            raise RuntimeError(f'Installed {package} does not match pinned {version}')
    validator = research / PREBUILD / 'native-live/tools/solana-release/bin/solana-test-validator'
    version = subprocess.check_output([str(validator), '--version'], text=True).strip()
    if '4.3.0' not in version:
        raise RuntimeError(f'Expected Agave 4.3.0, received {version}')
    for source in [args.idl, *(getattr(args, kind + '_elf') for kind in PROGRAMS),
                   *(args.circuits / f'{name}.{extension}' for name in
                     ['runtime_budget_init', 'runtime_budget_bound'] for extension in ['arcis', 'hash', 'idarc', 'weight'])]:
        if not source.is_file():
            raise RuntimeError(f'Missing build input: {source}')
    os.umask(0o077)
    destination.mkdir(parents=True, mode=0o700)
    destination.chmod(0o700)
    app = destination / APP
    native = destination / PREBUILD / 'native-live'
    records = []

    def copy(source, target, secret=False):
        source = source.resolve(strict=True)
        target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        shutil.copyfile(source, target)
        target.chmod(0o600)
        records.append({'path': str(target.relative_to(destination)), 'source': str(source),
                        'kind': 'disposable-local-secret' if secret else 'artifact',
                        **({} if secret else {'source_sha256': sha256(source)})})

    for name in ['probe.cjs', 'extra-checks.cjs', 'package.json']:
        copy(original / name, app / name)
    lock = research / 'research/cyperlink-probes-2026-10-01/authenticated/cyperlink_auth/package-lock.json'
    copy(lock, app / 'package-lock.json')
    (app / 'node_modules').symlink_to(modules, target_is_directory=True)
    if args.admission_checks:
        copy(args.admission_checks, app / 'admission-checks.cjs')
        probe_path = app / 'probe.cjs'
        probe = probe_path.read_text()
        marker = ' const jobs={};'
        if probe.count(marker) != 1:
            raise RuntimeError('Admission-check insertion point drifted')
        probe_path.write_text(probe.replace(marker, " await require('./admission-checks.cjs')({program,connection,admin,native,send,accounts,pk,cipher,bn,evidence,save});\n" + marker))
    copy(original / 'local-test-wallet.json', app / 'local-test-wallet.json', secret=True)
    copy(args.idl, app / 'target/idl/cyperlink_auth.json')
    for name in ['runtime_budget_init', 'runtime_budget_bound']:
        for extension in ['arcis', 'hash', 'idarc', 'weight']:
            copy(args.circuits / f'{name}.{extension}', app / f'build/{name}.{extension}')
    copy(research / PREBUILD / 'native-live/client.cjs', native / 'client.cjs')
    client = (native / 'client.cjs').read_text().replace(
        "../../cyperlink-probes-2026-10-01/authenticated/cyperlink_auth/package.json",
        '../bound-join/cyperlink_auth/package.json')
    (native / 'client.cjs').write_text(client)
    for label in ['a', 'b']:
        for name in [f'fixture-{label}.json', f'live-proof-instructions-{label}.json']:
            copy(research / PREBUILD / 'native-live' / name, native / name)
        copy(research / PREBUILD / f'native-live/.keys/owner-{label}.json',
             native / f'.keys/owner-{label}.json', secret=True)
    genesis_args = json.loads((research / PREBUILD / 'native-live/genesis-args.json').read_text())
    if len(genesis_args) % 3 or any(genesis_args[i] != '--account' for i in range(0, len(genesis_args), 3)):
        raise RuntimeError('Unexpected native genesis argument format')
    for i in range(0, len(genesis_args), 3):
        source = Path(genesis_args[i + 2])
        # Archived arguments contain the original checkout prefix; honor research-root relocation.
        source = research / PREBUILD / 'native-live/genesis' / source.name
        target = native / 'genesis' / source.name
        copy(source, target)
        genesis_args[i + 2] = str(target)
    (native / 'genesis-args.json').write_text(json.dumps(genesis_args, indent=2) + '\n')
    for source in (original / 'artifacts').glob('*.json'):
        value = json.loads(source.read_text())
        if isinstance(value, dict) and 'pubkey' in value and 'account' in value:
            copy(source, app / 'artifacts' / source.name)
    public_ip_patches = []
    # Reviewed Arcium 0.15.0 public account layout. Fail closed if fixture layout drifts.
    fields = [('cluster_acc_0.json', 9, 99), ('arx_node_CW7B_a6Fp.json', 72, 100),
              ('arx_node_CCVY_oY4w.json', 72, 101)]
    for filename, offset, host in fields:
        path = app / 'artifacts' / filename
        account = json.loads(path.read_text())
        if account['account']['data'][1] != 'base64':
            raise RuntimeError('Unexpected genesis encoding')
        data = bytearray(base64.b64decode(account['account']['data'][0]))
        old = ipaddress.ip_address(f'172.20.0.{host}')
        new = subnet.network_address + host
        if data[offset:offset + 4] != old.packed or data.count(old.packed) != 1:
            raise RuntimeError(f'Unexpected public peer address layout in {filename}')
        data[offset:offset + 4] = new.packed
        account['account']['data'][0] = base64.b64encode(data).decode()
        path.write_text(json.dumps(account, indent=2) + '\n')
        public_ip_patches.append({'file': filename, 'offset': offset, 'old': str(old), 'new': str(new)})
    for name, service in services.items():
        host = 99 if name == 'arcium-trusted-dealer' else 100 + int(name[-1])
        service['networks'] = {'arx_network': {'ipv4_address': str(subnet.network_address + host)}}
        service['restart'] = 'no'
        service['pull_policy'] = 'never'
        if name.startswith('arx-node-'):
            service['ports'] = [{'target': 9091, 'published': str(args.metrics_port + int(name[-1])),
                                 'host_ip': '127.0.0.1', 'protocol': 'tcp'}]
        for mount in service['volumes']:
            source = Path(mount['source'])
            # All reviewed sources are rooted at artifacts; never mount the research tree.
            relative = source.parts[source.parts.index('artifacts') + 1:]
            target = app / 'artifacts' / Path(*relative)
            archived = original / 'artifacts' / Path(*relative)
            if archived.is_dir():
                target.mkdir(parents=True, exist_ok=True, mode=0o700)
                mount['read_only'] = False
            else:
                secret = relative[0] == 'localnet'
                copy(archived, target, secret=secret)
                mount['read_only'] = True
                if target.suffix == '.toml':
                    content = target.read_text().replace(':8899', f':{args.rpc_port}').replace(
                        ':8900', f':{args.rpc_port + 1}').replace('172.20.0.99', str(subnet.network_address + 99))
                    target.write_text(content)
            mount['source'] = str(target)
    compose = {'name': 'cyperlink-' + args.run_id.lower().replace('_', '-'), 'services': services,
               'networks': {'arx_network': {'driver': 'bridge', 'ipam': {'config': [{'subnet': str(subnet)}]}}}}
    compose_path = app / 'artifacts/compose.json'
    compose_path.write_text(json.dumps(compose, indent=2) + '\n')
    deployments = []
    for kind, (address, filename) in PROGRAMS.items():
        target = app / 'target/deploy' / filename
        copy(getattr(args, kind + '_elf'), target)
        deployments.append({'address': address, 'elf': str(target), 'upgradeable': kind == 'auth'})
    for address, filename in [
        ('Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ', 'arcium_program_0.15.0.so'),
        ('ArcStnN9zZZVB5WjgPhLHjYpY7Gb29mzb96ySsb1kxgq', 'arcium_staking_program_0.15.0.so'),
        ('L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95', 'lighthouse.so')]:
        target = app / 'artifacts' / filename
        copy(original / 'artifacts' / filename, target)
        deployments.append({'address': address, 'elf': str(target), 'upgradeable': False})
    token = research / PREBUILD / 'compatibility/deployed-elf/evidence/mainnet-token-2022.so'
    if sha256(token) != '0999dbf708971e723b08d1caafc988826a59c6001ed6dc02260da07defbe1469':
        raise RuntimeError('Captured Token-2022 ELF differs from pinned baseline')
    target = app / 'artifacts/token-2022.so'
    copy(token, target)
    deployments.append({'address': 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb',
                        'elf': str(target), 'upgradeable': False})
    command = [str(validator), '--ledger', str(app / 'ledger'), '--bind-address', '127.0.0.1',
               '--rpc-port', str(args.rpc_port), '--quiet', *genesis_args]
    for deployment in deployments:
        command += ['--upgradeable-program' if deployment['upgradeable'] else '--bpf-program',
                    deployment['address'], deployment['elf']]
        if deployment['upgradeable']:
            command += [str(app / 'local-test-wallet.json')]
    for path in sorted((app / 'artifacts').glob('*.json')):
        account = json.loads(path.read_text())
        if isinstance(account, dict) and 'pubkey' in account and 'account' in account:
            command += ['--account', account['pubkey'], str(path)]
    (app / 'validator-command.json').write_text(json.dumps(command, indent=2) + '\n')
    (app / 'run-validator.py').write_text('''#!/usr/bin/env python3
import json, os, socket
from pathlib import Path
p = Path(__file__).resolve().parent
args = json.loads((p / 'validator-command.json').read_text())
if (p / 'ledger').exists():
    raise SystemExit('Ledger already exists: prepare a fresh run instead of resetting evidence')
port = int(args[args.index('--rpc-port') + 1])
for value in (port, port + 1):
    with socket.socket() as s:
        s.bind(('127.0.0.1', value))
os.chdir(p)
os.execv(args[0], args)
''')
    # Record copied bytes after networking adaptations. Never hash or print signing secrets.
    for record in records:
        if record['kind'] == 'artifact':
            record['staged_sha256'] = sha256(destination / record['path'])
    report = {'scope': 'prepared only; same-machine synthetic local replay, no execution claim',
              'run_id': args.run_id, 'app': str(app), 'rpc': f'http://127.0.0.1:{args.rpc_port}',
              'compose_project': compose['name'], 'subnet': str(subnet), 'validator': version,
              'validator_sha256': sha256(validator),
              'javascript_versions': {'@arcium-hq/client': '0.15.0', '@anchor-lang/core': '1.2.0'}, 'node_modules_read_only_reference': str(modules),
              'genesis_accounts': command.count('--account'), 'public_ip_patches': public_ip_patches,
              'deployments': deployments, 'files': records}
    (destination / 'preparation.json').write_text(json.dumps(report, indent=2) + '\n')
    subprocess.run(['docker', 'compose', '-f', str(compose_path), 'config', '--quiet'], check=True)
    print(json.dumps({key: report[key] for key in ['scope', 'app', 'rpc', 'compose_project', 'subnet', 'genesis_accounts']}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'Preparation failed: {error}', file=sys.stderr)
        sys.exit(1)
