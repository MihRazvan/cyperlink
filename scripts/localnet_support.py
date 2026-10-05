"""Pinned local bootstrap identities and collision checks.

These helpers inspect local availability only; they never launch a validator,
create Docker networks, or read a research checkout.
"""
import ipaddress
import json
import socket
import subprocess

PROGRAMS = {
    'auth': ('5bgSoi3WbUndQNhWrkxJoURjkRd28BxxucZozwGR9AQQ', 'cyperlink_auth.so'),
    'guard': ('6URwbPipuA4MJLG7LCRRZuWnms3JZ9cRG3z9indXWz8G', 'ct_guard_spike.so'),
    'policy': ('6YMEjhBqVTMaSRWcmVkLrnHZ22FWEDJEpTeonAg8GKSy', 'ct_policy_spike.so'),
    'merchant': ('6cGXszer5keoaWm8Co5G9f4KGBThuGz4NsKTqYij1emg', 'cyperlink_merchant.so'),
    'license': ('6gBq2J7rg3x2ic1de6QBSXq5WLfuaLfswGz7tvmKkz6P', 'cyperlink_license.so'),
    'proof_buffer': ('71nJjoSudYSAR4GApb2mtugtj8iuwf6yjKKQBpzKVehv', 'cyperlink_proof_buffer.so'),
}


def run_json(*args):
    return json.loads(subprocess.check_output(args, text=True, stderr=subprocess.PIPE))

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
