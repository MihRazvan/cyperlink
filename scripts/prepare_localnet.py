#!/usr/bin/env python3
"""Prepare a fresh pinned localnet with generated identities and no research checkout."""
import argparse
import base64
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

from prepare_local_replay import PROGRAMS, available_port, choose_subnet
from rebuild_circuits import check_artifacts
from setup_local_js import load_config, check_installed

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def checked_path(root, raw):
    path = Path(raw)
    if not path.is_absolute():
        path = root / path
    if path.resolve() != path or not path.is_relative_to(root) or not path.is_file():
        raise ValueError(f'Expected regular local input below {root}: {path}')
    return path


def patch_peer(path, offset, old, new):
    account = json.loads(path.read_text())
    if account['account']['data'][1] != 'base64':
        raise ValueError('Unexpected runtime genesis encoding')
    raw = bytearray(base64.b64decode(account['account']['data'][0], validate=True))
    before, after = ipaddress.ip_address(old).packed, ipaddress.ip_address(new).packed
    if raw[offset:offset + 4] != before or raw.count(before) != 1:
        raise ValueError(f'Runtime peer layout drift: {path.name}')
    raw[offset:offset + 4] = after
    account['account']['data'][0] = base64.b64encode(raw).decode()
    path.write_text(json.dumps(account, indent=2) + '\n')
    return {'file': path.name, 'offset': offset, 'old': old, 'new': new}


def compose_for(app, run_id, subnet, metrics_port):
    template = json.loads((ROOT / 'config/local-compose.json').read_text())
    pins = json.loads((ROOT / 'config/local-toolchain.json').read_text())
    for name, service in template['services'].items():
        if service['image'] != pins['docker_images'][name] or '@sha256:' not in service['image']:
            raise ValueError('Unqualified runtime image')
        host = 99 if name == 'arcium-trusted-dealer' else 100 + int(name[-1])
        service['networks'] = {'arx_network': {'ipv4_address': str(subnet.network_address + host)}}
        if name.startswith('arx-node-'):
            service['ports'] = [{'target': 9091, 'published': str(metrics_port + int(name[-1])), 'host_ip': '127.0.0.1', 'protocol': 'tcp'}]
        for mount in service['volumes']:
            relative = Path(mount['source'])
            if relative.is_absolute() or '..' in relative.parts or relative.parts[0] != 'artifacts':
                raise ValueError('Unsafe runtime mount')
            target = app / relative
            if target.resolve() != target:
                raise ValueError('Runtime mount may not traverse symlinks')
            if mount['read_only']:
                if not target.is_file():
                    raise ValueError(f'Missing generated runtime input {relative}')
            else:
                target.mkdir(parents=True, exist_ok=True, mode=0o700)
                if any(target.iterdir()):
                    raise ValueError(f'Runtime output is not fresh: {relative}')
            mount['source'] = str(target)
    return {'name': 'cyperlink-' + run_id, 'services': template['services'],
            'networks': {'arx_network': {'driver': 'bridge', 'ipam': {'config': [{'subnet': str(subnet)}]}}}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run-id', required=True)
    parser.add_argument('--toolchain', type=Path, default=ROOT / '.local/toolchain/native')
    parser.add_argument('--module-root', type=Path, default=ROOT / '.local/toolchain/js')
    parser.add_argument('--circuits', type=Path, default=ROOT / 'programs/auth/build')
    parser.add_argument('--rpc-port', type=int, default=8899)
    parser.add_argument('--metrics-port', type=int, default=9091)
    args = parser.parse_args()
    if not re.fullmatch('[a-z0-9][a-z0-9-]{0,48}', args.run_id):
        parser.error('run-id must contain 1–49 lowercase letters, numbers or hyphens')
    ports = [args.rpc_port, args.rpc_port + 1, args.metrics_port, args.metrics_port + 1]
    if len(set(ports)) != 4 or not all(1024 <= p <= 65535 for p in ports):
        parser.error('Choose four distinct unprivileged ports')
    for port in ports:
        available_port(port)
    toolchain = args.toolchain.absolute()
    if toolchain.resolve() != toolchain or not toolchain.is_relative_to(ROOT / '.local'):
        parser.error('Toolchain must be an actual directory below repository .local')
    install = json.loads((toolchain / 'installation.json').read_text())
    executables = {name: checked_path(toolchain, record['path']) for name, record in install['executables'].items()}
    programs = {name: checked_path(toolchain, record['path']) for name, record in install['programs'].items()}
    for group, paths in [('executables', executables), ('programs', programs)]:
        for name, path in paths.items():
            if digest(path) != install[group][name].get('sha256', install[group][name].get('elf_sha256')):
                raise ValueError(f'Installed input changed: {name}')
    # Manifest itself is not an authority: verify pinned upstream runtime inputs.
    pins = json.loads((ROOT / 'config/local-toolchain.json').read_text())
    for name, pin in pins['executables'].items():
        if pin.get('sha256') and digest(executables[name]) != pin['sha256']:
            raise ValueError(f'Executable pin mismatch: {name}')
    for pin in pins['assets'] + pins['public_programs']:
        if pin['name'] in programs and digest(programs[pin['name']]) != pin['sha256']:
            raise ValueError(f'Program pin mismatch: {pin["name"]}')
    if not subprocess.check_output([str(executables['validator']), '--version'], text=True).startswith('solana-test-validator 4.3.0 '):
        raise ValueError('Unqualified validator version')
    modules = args.module_root.absolute()
    if not modules.is_relative_to(ROOT / '.local'):
        raise ValueError('JS environment must be beneath repository .local')
    check_installed(modules, *load_config())
    circuits = args.circuits.resolve(strict=True)
    if not circuits.is_relative_to(ROOT):
        raise ValueError('Circuit inputs must be built or checked in within this repository')
    baseline = json.loads((ROOT / 'circuits/budget/baseline.json').read_text())
    for filename in baseline['artifacts']:
        checked_path(ROOT, circuits / filename)
    check_artifacts(circuits, baseline)
    idl = ROOT / 'programs/auth/target/idl/cyperlink_auth.json'
    inputs = [idl, *(ROOT / 'target/deploy' / filename for _, filename in PROGRAMS.values())]
    for path in inputs:
        checked_path(ROOT, path)
    subnet = choose_subnet(None)
    out = ROOT / '.local' / ('localnet-' + args.run_id)
    if out.exists() or out.resolve() != out:
        raise ValueError('Run directory exists or traverses a symlink; choose a fresh run ID')
    os.umask(0o077)
    out.mkdir(parents=True, mode=0o700)
    app = out / 'app'
    subprocess.run([sys.executable, str(ROOT / 'scripts/generate_runtime.py'), '--arcium', str(executables['arcium']),
                    '--solana-keygen', str(executables['solana_keygen']), '--arcium-elf', str(programs['arcium-program']),
                    '--staking-elf', str(programs['arcium-staking']), '--lighthouse-elf', str(programs['lighthouse']), '--out', str(app)], check=True)
    generation = json.loads((app / 'generation.json').read_text())
    forbidden = {address for address, _ in PROGRAMS.values()}
    if any(a['owner'] in forbidden for a in generation['genesis_accounts']):
        raise ValueError('CyperLink state must be provisioned by signed instructions, never runtime genesis')
    artifacts = app / 'artifacts'
    patches = [patch_peer(artifacts / 'cluster_acc_0.json', 9, '172.20.0.99', str(subnet.network_address + 99))]
    nodes = list(artifacts.glob('arx_node_*.json'))
    if len(nodes) != 2:
        raise ValueError('Expected exactly two fresh runtime nodes')
    for host in [100, 101]:
        old = ipaddress.ip_address(f'172.20.0.{host}').packed
        found = [p for p in nodes if base64.b64decode(json.loads(p.read_text())['account']['data'][0])[72:76] == old]
        if len(found) != 1:
            raise ValueError('Cannot uniquely identify generated node peer address')
        patches.append(patch_peer(found[0], 72, f'172.20.0.{host}', str(subnet.network_address + host)))
    for name in ['node_config_0.toml', 'node_config_1.toml', 'trusted_dealer_config.toml']:
        path = artifacts / name
        content = path.read_text().replace(':8899', f':{args.rpc_port}').replace(':8900', f':{args.rpc_port + 1}')
        content = content.replace('172.20.0.99', str(subnet.network_address + 99))
        path.write_text(content)
    compose = compose_for(app, args.run_id, subnet, args.metrics_port)
    (artifacts / 'compose.json').write_text(json.dumps(compose, indent=2) + '\n')
    # CLI-generated latest-tag file is generation evidence only; never launch it.
    (artifacts / 'docker-compose-arx-env.yml').rename(artifacts / 'upstream-compose.yml.disabled')
    deployments = []
    (app / 'target/deploy').mkdir(parents=True)
    (app / 'target/idl').mkdir(parents=True)
    shutil.copyfile(idl, app / 'target/idl/cyperlink_auth.json')
    (app / 'build').mkdir()
    for source in circuits.glob('runtime_budget_*.*'):
        if source.suffix in ['.arcis', '.hash', '.idarc', '.weight']:
            shutil.copyfile(source, app / 'build' / source.name)
    for kind, (address, filename) in PROGRAMS.items():
        target = app / 'target/deploy' / filename
        shutil.copyfile(ROOT / 'target/deploy' / filename, target)
        deployments.append({'address': address, 'elf': str(target), 'upgradeable': kind == 'auth'})
    for name, address in [('arcium-program', 'Arcj82pX7HxYKLR92qvgZUAd7vGS1k4hQvAFcPATFdEQ'),
                          ('arcium-staking', 'ArcStnN9zZZVB5WjgPhLHjYpY7Gb29mzb96ySsb1kxgq'),
                          ('lighthouse', 'L2TExMFKdjpN9kozasaurPirfHy9P8sbXoAN1qA3S95'),
                          ('token-2022', 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb')]:
        target = artifacts / (name + '.so')
        shutil.copyfile(programs[name], target)
        deployments.append({'address': address, 'elf': str(target), 'upgradeable': False})
    command = [str(executables['validator']), '--ledger', str(app / 'ledger'), '--bind-address', '127.0.0.1', '--rpc-port', str(args.rpc_port), '--quiet']
    for d in deployments:
        command += ['--upgradeable-program' if d['upgradeable'] else '--bpf-program', d['address'], d['elf']]
        if d['upgradeable']: command += [str(app / 'local-test-wallet.json')]
    for record in generation['genesis_accounts']:
        command += ['--account', record['pubkey'], record['path']]
    (app / 'validator-command.json').write_text(json.dumps(command, indent=2) + '\n')
    (app / 'run-validator.py').write_text('''#!/usr/bin/env python3
import json, os, socket
from pathlib import Path
p = Path(__file__).resolve().parent
args = json.loads((p / 'validator-command.json').read_text())
if (p / 'ledger').exists(): raise SystemExit('Ledger exists; never reset evidence')
port = int(args[args.index('--rpc-port') + 1])
for value in (port, port + 1):
    with socket.socket() as s: s.bind(('127.0.0.1', value))
os.chdir(p)
os.execv(args[0], args)
''')
    report = {'scope': 'fresh generated local bootstrap; preparation only, no execution claim', 'profile': 'provisioned161',
              'bootstrap': 'fresh-upstream-generated', 'research_checkout_required': False, 'run_id': args.run_id,
              'app': str(app), 'rpc': f'http://127.0.0.1:{args.rpc_port}', 'compose_project': compose['name'],
              'subnet': str(subnet), 'payer': generation['payer'], 'genesis_accounts': len(generation['genesis_accounts']),
              'generation_manifest_sha256': digest(app / 'generation.json'), 'public_ip_patches': patches,
              'module_root': str(modules), 'validator_sha256': digest(executables['validator']),
              'deployments': [{**d, 'sha256': digest(d['elf'])} for d in deployments],
              'staged_public_genesis': [{**r, 'staged_sha256': digest(r['path'])} for r in generation['genesis_accounts']]}
    (out / 'preparation.json').write_text(json.dumps(report, indent=2) + '\n')
    subprocess.run(['docker', 'compose', '-f', str(artifacts / 'compose.json'), 'config', '--quiet'], check=True)
    print(json.dumps({k: report[k] for k in ['scope', 'app', 'rpc', 'compose_project', 'genesis_accounts', 'payer']}, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, KeyError, RuntimeError, subprocess.SubprocessError) as error:
        print(f'Localnet preparation failed: {error}', file=sys.stderr)
        sys.exit(1)
