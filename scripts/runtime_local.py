#!/usr/bin/env python3
"""Own and resume a prepared local validator and its retained Arcium containers.

This controller never resets a ledger, regenerates identities, removes containers,
changes dependencies, or submits an application transaction. Readiness proves RPC,
artifact and process availability; fresh distributed execution is a separate test.
"""
import argparse
import base64
from contextlib import contextmanager
import fcntl
import hashlib
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = Path(__file__).resolve().parents[1]
SCHEMA = 'cyperlink-local-runtime-v1'
LOADER = 'BPFLoaderUpgradeab1e11111111111111111111111'
BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'


class RuntimeErrorDetail(RuntimeError):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def fail(code, message):
    raise RuntimeErrorDetail(code, message)


def read_json(path):
    return json.loads(Path(path).read_text())


def sha256(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def atomic_json(path, value):
    """Durably publish one journal revision; no private file contents in JSON output."""
    path = Path(path)
    temporary = path.with_name(path.name + '.' + uuid.uuid4().hex + '.tmp')
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(descriptor, 'w') as stream:
            json.dump(value, stream, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory)
        finally:
            os.close(directory)
    finally:
        temporary.unlink(missing_ok=True)


def regular(path):
    path = Path(path).absolute()
    if path.resolve() != path or not path.is_file():
        fail('INPUT_MISSING_OR_LINKED', f'Expected unchanged regular input: {path.name}')
    return path


def command(args, timeout=30):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        # Upstream stderr can contain configuration/private paths; retain it only in
        # operator logs when needed, never return arbitrary subprocess output to APIs.
        fail('PROCESS_FAILED', f'{Path(args[0]).name} exited with status {result.returncode}')
    return result.stdout


def process_identity(pid):
    if type(pid) is not int or pid <= 1:
        return None
    result = subprocess.run(['ps', '-ww', '-p', str(pid), '-o', 'lstart=', '-o', 'command='],
                            capture_output=True, text=True)
    fields = result.stdout.strip().split(None, 5)
    if result.returncode or len(fields) != 6:
        return None
    return {'pid': pid, 'started': ' '.join(fields[:5]), 'command': fields[5]}


def process_owned(record, argv):
    if not record:
        return False
    observed = process_identity(record.get('pid'))
    return bool(observed and observed['started'] == record.get('started')
                and observed['command'] == ' '.join(argv))


def base58(data):
    integer = int.from_bytes(data, 'big')
    output = ''
    while integer:
        integer, digit = divmod(integer, 58)
        output = BASE58[digit] + output
    return '1' * (len(data) - len(data.lstrip(b'\0'))) + output


class Runtime:
    def __init__(self, environment):
        path = Path(environment).absolute()
        self.directory = path.parent if path.name == 'preparation.json' else path
        if self.directory.resolve() != self.directory or not self.directory.is_relative_to(ROOT / '.local'):
            fail('ENVIRONMENT_PATH', 'Runtime environment must be an actual directory below repository .local')
        self.preparation_path = regular(self.directory / 'preparation.json')
        self.preparation = read_json(self.preparation_path)
        self.app = Path(self.preparation['app'])
        if self.app != self.directory / 'app' or self.app.resolve() != self.app:
            fail('ENVIRONMENT_PATH', 'Prepared application path does not match environment')
        self.argv = read_json(regular(self.app / 'validator-command.json'))
        self.compose_path = regular(self.app / 'artifacts/compose.json')
        self.compose = read_json(self.compose_path)
        self.state_path = self.directory / 'runtime.json'
        self.override_path = self.directory / 'runtime-compose.json'
        self.ledger = self.app / 'ledger'
        self.rpc_url = self.preparation['rpc']
        self.port = int(self.argv[self.argv.index('--rpc-port') + 1])
        if self.rpc_url != f'http://127.0.0.1:{self.port}' or not 1024 <= self.port < 65535:
            fail('RPC_NOT_LOCAL', 'Only prepared loopback RPC is supported')
        if '--reset' in self.argv or self.argv[self.argv.index('--ledger') + 1] != str(self.ledger):
            fail('LEDGER_COMMAND', 'Validator command must retain the exact prepared ledger')
        if self.argv[self.argv.index('--bind-address') + 1] != '127.0.0.1':
            fail('RPC_NOT_LOCAL', 'Validator must bind loopback')
        self.state = read_json(regular(self.state_path)) if self.state_path.exists() else None
        if self.state and self.state.get('schema') != SCHEMA:
            fail('STATE_SCHEMA', 'Unsupported runtime journal schema')

    @contextmanager
    def lock(self):
        path = self.directory / 'runtime.lock'
        if path.is_symlink():
            fail('LOCK_PATH', 'Runtime lock must not be a symlink')
        with os.fdopen(os.open(path, os.O_RDWR | os.O_CREAT, 0o600), 'a+') as stream:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                fail('LIFECYCLE_BUSY', 'Another runtime lifecycle operation owns this environment')
            try:
                # Another short-lived controller may have completed between this
                # object's construction and lock acquisition. Never overwrite its
                # ownership journal using a stale in-memory snapshot.
                self.state = read_json(regular(self.state_path)) if self.state_path.exists() else None
                yield
            finally:
                fcntl.flock(stream, fcntl.LOCK_UN)

    def save(self, phase=None):
        if phase:
            self.state['phase'] = phase
        atomic_json(self.state_path, self.state)

    def inputs(self):
        """Check pins and snapshot immutable material, retaining only file digests."""
        pins = read_json(ROOT / 'config/local-toolchain.json')
        validator = regular(self.argv[0])
        if sha256(validator) != pins['executables']['validator']['sha256']:
            fail('VALIDATOR_PIN', 'Validator executable differs from the pinned artifact')
        if sha256(validator) != self.preparation['validator_sha256']:
            fail('VALIDATOR_PIN', 'Prepared validator identity differs')
        if self.compose.get('name') != self.preparation['compose_project']:
            fail('COMPOSE_IDENTITY', 'Compose project differs from preparation')
        if set(self.compose['services']) != set(pins['docker_images']):
            fail('COMPOSE_PROFILE', 'Expected exactly the three pinned runtime services')
        files = [self.preparation_path, self.app / 'validator-command.json', self.compose_path,
                 self.app / 'generation.json', validator]
        mutable = []
        for name, service in self.compose['services'].items():
            if service['image'] != pins['docker_images'][name] or service.get('pull_policy') != 'never':
                fail('IMAGE_PIN', f'Runtime image differs: {name}')
            if service.get('restart') != 'no':
                fail('COMPOSE_PROFILE', 'Automatic container restart is unsupported')
            for mount in service['volumes']:
                source = Path(mount['source'])
                if source.resolve() != source or not source.is_relative_to(self.app / 'artifacts'):
                    fail('MOUNT_PATH', 'Runtime mount escapes prepared artifacts or traverses a symlink')
                if mount['read_only']:
                    files.append(regular(source))
                else:
                    if not source.is_dir():
                        fail('RETAINED_VOLUME_MISSING', 'Retained runtime output directory is missing')
                    stat = source.stat()
                    mutable.append({'path': str(source), 'device': stat.st_dev, 'inode': stat.st_ino})
        for deployment in self.preparation['deployments']:
            path = regular(deployment['elf'])
            if sha256(path) != deployment['sha256']:
                fail('ELF_CHANGED', 'Prepared program ELF differs from its original build')
            files.append(path)
        for account in self.preparation['staged_public_genesis']:
            path = regular(account['path'])
            if sha256(path) != account['staged_sha256']:
                fail('GENESIS_INPUT_CHANGED', 'Prepared genesis account changed')
            files.append(path)
        return {'files': {str(path): sha256(regular(path)) for path in sorted(set(files))},
                'retained_directories': sorted(mutable, key=lambda item: item['path'])}

    def verify_inputs(self):
        current = self.inputs()
        if self.state and current != self.state['inputs']:
            fail('IDENTITY_CHANGED', 'Prepared configuration, identities, artifacts or retained directories changed')
        if self.state and self.state.get('genesis_file_sha256'):
            if sha256(regular(self.ledger / 'genesis.bin')) != self.state['genesis_file_sha256']:
                fail('GENESIS_CHANGED', 'Retained genesis file changed')
        for path, digest in (self.state or {}).get('ledger_identity_files', {}).items():
            if sha256(regular(path)) != digest:
                fail('LEDGER_IDENTITY_CHANGED', 'Retained validator signing identity changed')
        return current

    def rpc(self, method, params=None):
        payload = json.dumps({'jsonrpc': '2.0', 'id': 1, 'method': method, 'params': params or []}).encode()
        request = urllib.request.Request(self.rpc_url, data=payload, headers={'Content-Type': 'application/json'})
        try:
            # Do not route loopback through an environment-configured HTTP proxy.
            response = urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=5)
            with response:
                value = json.load(response)
        except (OSError, ValueError, urllib.error.URLError) as error:
            raise RuntimeErrorDetail('RPC_UNAVAILABLE', 'Prepared local RPC is unavailable') from error
        if value.get('error') or 'result' not in value:
            fail('RPC_RESPONSE', f'Local RPC did not provide {method}')
        return value['result']

    def account(self, address):
        return self.rpc('getAccountInfo', [address, {'encoding': 'base64', 'commitment': 'confirmed'}])['value']

    def verify_chain(self):
        genesis = self.rpc('getGenesisHash')
        if self.state.get('genesis') and genesis != self.state['genesis']:
            fail('GENESIS_CHANGED', 'RPC ledger does not match retained runtime identity')
        if self.rpc('getVersion').get('solana-core') != '4.3.0':
            fail('RPC_VERSION', 'Local RPC is not pinned Agave 4.3.0')
        checked = []
        for deployment in self.preparation['deployments']:
            account = self.account(deployment['address'])
            if not account or not account.get('executable'):
                fail('LOADED_ELF', 'Prepared program is missing or not executable')
            raw = base64.b64decode(account['data'][0], validate=True)
            # Agave 4.3 also wraps immutable --bpf-program genesis inputs in
            # the upgradeable loader with no upgrade authority. Decode the actual
            # owner, not the preparation flag that selects CLI syntax.
            if account.get('owner') == LOADER:
                if raw[:4] != b'\2\0\0\0' or len(raw) != 36:
                    fail('LOADED_ELF', 'Invalid upgradeable program pointer')
                data = self.account(base58(raw[4:36]))
                if not data or data['owner'] != LOADER:
                    fail('LOADED_ELF', 'Upgradeable program data is missing')
                raw = base64.b64decode(data['data'][0], validate=True)
                if raw[:4] != b'\3\0\0\0':
                    fail('LOADED_ELF', 'Invalid upgradeable program data')
                raw = raw[45:]
            elif deployment['upgradeable'] or account.get('owner') not in (
                    'BPFLoader2111111111111111111111111111111111',
                    'BPFLoader1111111111111111111111111111111111'):
                fail('LOADED_ELF', 'Unexpected executable loader owner')
            expected = Path(deployment['elf']).read_bytes()
            if raw[:len(expected)] != expected or any(raw[len(expected):]):
                fail('LOADED_ELF', 'Actual loaded program bytes differ from the retained build')
            checked.append(deployment['address'])
        for deviation in self.preparation.get('validator_feature_deviations', []):
            account = self.account(deviation['feature'])
            if account and base64.b64decode(account['data'][0], validate=True)[:1] != b'\0':
                fail('FEATURE_CHANGED', 'Qualified local deployment feature exception is no longer inactive')
        return {'genesis': genesis, 'loaded_programs': checked}

    def containers(self):
        project = self.preparation['compose_project']
        ids = command(['docker', 'ps', '-aq', '--filter', f'label=com.docker.compose.project={project}']).split()
        return json.loads(command(['docker', 'inspect', *ids])) if ids else []

    def owned_containers(self):
        records = self.containers()
        owned = {}
        for container in records:
            labels = container['Config'].get('Labels') or {}
            name = labels.get('com.docker.compose.service')
            if not self.state or labels.get('io.cyperlink.runtime') != self.state['runtime_id']:
                fail('CONTAINER_NOT_OWNED', 'Compose project contains a container not owned by this runtime')
            if name not in self.compose['services'] or name in owned:
                fail('CONTAINER_IDENTITY', 'Unexpected or duplicate runtime service')
            if container['Config']['Image'] != self.compose['services'][name]['image']:
                fail('CONTAINER_IDENTITY', 'Runtime container image differs from its pin')
            expected_mounts = {(item['source'], item['target'], not item['read_only'])
                               for item in self.compose['services'][name]['volumes']}
            actual_mounts = {(item['Source'], item['Destination'], item['RW'])
                             for item in container.get('Mounts', [])}
            if actual_mounts != expected_mounts:
                fail('CONTAINER_MOUNTS', 'Runtime container mounts differ from retained configuration')
            retained = self.state.get('containers', {}).get(name)
            if retained and retained != container['Id']:
                fail('CONTAINER_REPLACED', 'Retained runtime container was replaced')
            owned[name] = container
        for name in self.state.get('containers', {}) if self.state else []:
            if name not in owned:
                fail('CONTAINER_MISSING', 'Retained runtime container is missing; automatic replacement is refused')
        return owned

    def inspect(self):
        issues = []
        try:
            self.verify_inputs()
        except (RuntimeErrorDetail, OSError) as error:
            issues.append({'code': getattr(error, 'code', 'INPUT_UNAVAILABLE'), 'message': str(error)})
        validator_owned = bool(self.state and process_owned(self.state.get('validator'), self.argv))
        components = {'validator': {'owned': validator_owned, 'running': validator_owned}, 'services': {}}
        try:
            records = self.owned_containers()
            components['services'] = {name: {'running': item['State']['Running'], 'status': item['State']['Status']}
                                      for name, item in records.items()}
        except RuntimeErrorDetail as error:
            issues.append({'code': error.code, 'message': str(error)})
        chain = None
        if validator_owned:
            try:
                chain = self.verify_chain()
            except RuntimeErrorDetail as error:
                issues.append({'code': error.code, 'message': str(error)})
        services_ready = (set(components['services']) == set(self.compose['services'])
                          and all(item['running'] for item in components['services'].values()))
        return {'schema': SCHEMA, 'profile': 'local-custom-policy-v1',
                'state': self.state['phase'] if self.state else 'prepared',
                'ready': bool(chain and services_ready and not issues),
                'readiness_scope': 'verified local RPC, loaded bootstrap ELFs and running containers; not fresh MPC execution',
                'runtime_id': self.state['runtime_id'] if self.state else None,
                'genesis': self.state.get('genesis') if self.state else None,
                'rpc': self.rpc_url, 'components': components, 'issues': issues}

    def ensure_ports(self):
        # The validator also owns its default faucet port. Never stop an unrelated
        # validator merely to free a conflicting port.
        ports = [self.port, self.port + 1]
        if '--faucet-port' in self.argv:
            ports.append(int(self.argv[self.argv.index('--faucet-port') + 1]))
        else:
            ports.append(9900)
        if '--gossip-port' in self.argv:
            ports.append(int(self.argv[self.argv.index('--gossip-port') + 1]))
        for port in ports:
            with socket.socket() as stream:
                # Match the validator's reusable listening sockets: closed RPC
                # connections may remain in TIME_WAIT after graceful shutdown.
                # SO_REUSEADDR permits that case but not a live listener at the
                # same address (we deliberately never set SO_REUSEPORT).
                stream.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
                try:
                    stream.bind(('127.0.0.1', port))
                except OSError:
                    fail('PORT_OCCUPIED', f'Local port {port} is already occupied')

    def launch_validator(self):
        self.ensure_ports()
        token = uuid.uuid4().hex
        self.state['launch_token'] = token
        self.state['validator'] = None
        self.save('starting-validator')
        log = self.directory / 'runtime-validator.log'
        with os.fdopen(os.open(log, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600), 'ab') as output:
            child = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '_validator-worker',
                                      '--environment', str(self.directory), '--token', token],
                                     stdin=subprocess.DEVNULL, stdout=output, stderr=output,
                                     start_new_session=True, close_fds=True)
        identity = process_identity(child.pid)
        if not identity:
            fail('VALIDATOR_LAUNCH', 'Validator worker exited before ownership was retained')
        self.state['validator'] = {'pid': child.pid, 'started': identity['started']}
        # The worker cannot exec the validator until its exact PID/start identity
        # has been durably recorded. Parent death before this write leaves a worker
        # which times out without starting a validator.
        self.save()

    def start(self, resume=False, timeout=90):
        with self.lock():
            inputs = self.verify_inputs()
            if not self.state:
                if resume or self.ledger.exists():
                    fail('UNMANAGED_LEDGER', 'Resume requires a runtime identity created by managed first start')
                if self.containers():
                    fail('CONTAINER_NOT_OWNED', 'Prepared Compose project is already in use')
                self.state = {'schema': SCHEMA, 'runtime_id': str(uuid.uuid4()), 'phase': 'enrolled',
                              'inputs': inputs, 'genesis': None, 'containers': {}, 'validator': None}
                self.save()
            elif not resume:
                fail('ALREADY_ENROLLED', 'Runtime already enrolled; use resume to reconcile retained state')
            if self.state.get('genesis') and not self.ledger.is_dir():
                fail('LEDGER_MISSING', 'Retained ledger is missing; automatic recreation is refused')
            if not process_owned(self.state.get('validator'), self.argv):
                record = self.state.get('validator')
                if record and process_identity(record['pid']):
                    fail('PROCESS_NOT_OWNED', 'Retained validator PID now identifies a different process')
                self.launch_validator()
            deadline = time.monotonic() + timeout
            while True:
                try:
                    chain = self.verify_chain()
                    break
                except RuntimeErrorDetail as error:
                    if error.code not in ('RPC_UNAVAILABLE', 'RPC_RESPONSE') or time.monotonic() >= deadline:
                        raise
                    if not process_identity(self.state['validator']['pid']):
                        fail('VALIDATOR_EXITED', 'Validator exited; retained runtime log contains diagnostics')
                    time.sleep(0.25)
            self.state['genesis'] = chain['genesis']
            self.state['genesis_file_sha256'] = sha256(regular(self.ledger / 'genesis.bin'))
            self.state['ledger_identity_files'] = {
                str(regular(self.ledger / name)): sha256(self.ledger / name)
                for name in ['validator-keypair.json', 'vote-account-keypair.json',
                             'stake-account-keypair.json', 'faucet-keypair.json']}
            self.save('starting-services')
            records = self.owned_containers()
            if set(records) != set(self.compose['services']):
                override = {'services': {name: {'labels': {'io.cyperlink.runtime': self.state['runtime_id']}}
                                         for name in self.compose['services']}}
                atomic_json(self.override_path, override)
                command(['docker', 'compose', '-f', str(self.compose_path), '-f', str(self.override_path),
                         'create', '--no-recreate', '--pull', 'never'], timeout=90)
                records = self.owned_containers()
            if set(records) != set(self.compose['services']):
                fail('SERVICES_INCOMPLETE', 'Runtime creation is incomplete; retained containers require inspection')
            self.state['containers'] = {name: item['Id'] for name, item in records.items()}
            self.save()
            command(['docker', 'start', *self.state['containers'].values()], timeout=60)
            self.save('running')
            result = self.inspect()
            if not result['ready']:
                fail('RUNTIME_NOT_READY', 'Runtime services did not remain running; inspect retained runtime')
            return result

    def stop(self, timeout=30):
        with self.lock():
            if not self.state:
                fail('NOT_ENROLLED', 'No owned runtime exists to stop')
            self.verify_inputs()
            records = self.owned_containers()
            record = self.state.get('validator')
            observed = process_identity(record['pid']) if record else None
            if observed and not process_owned(record, self.argv):
                fail('PROCESS_NOT_OWNED', 'Retained validator PID does not identify the owned validator')
            self.save('stopping')
            running = [item['Id'] for item in records.values() if item['State']['Running']]
            if running:
                # docker stop escalates to SIGKILL on timeout. Send TERM explicitly
                # and report a timeout without destroying in-flight runtime state.
                command(['docker', 'kill', '--signal=SIGTERM', *running])
                deadline = time.monotonic() + timeout
                while any(item['State']['Running'] for item in self.owned_containers().values()):
                    if time.monotonic() >= deadline:
                        fail('STOP_TIMEOUT', 'Runtime containers did not stop gracefully; no forced kill was sent')
                    time.sleep(0.2)
            if observed:
                os.kill(record['pid'], signal.SIGINT)
                deadline = time.monotonic() + timeout
                while process_owned(record, self.argv):
                    if time.monotonic() >= deadline:
                        fail('STOP_TIMEOUT', 'Validator did not stop gracefully; no forced kill was sent')
                    time.sleep(0.1)
            self.state['validator'] = None
            self.save('stopped')
            return self.inspect()


def validator_worker(environment, token):
    runtime = Runtime(environment)
    identity = process_identity(os.getpid())
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        state = read_json(runtime.state_path)
        record = state.get('validator')
        if state.get('launch_token') != token:
            return 1
        if record == {'pid': os.getpid(), 'started': identity['started']}:
            runtime.state = state
            runtime.verify_inputs()
            os.chdir(runtime.app)
            os.execv(runtime.argv[0], runtime.argv)
        time.sleep(0.05)
    return 1


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['inspect', 'start', 'resume', 'stop', '_validator-worker'])
    parser.add_argument('--environment', required=True)
    parser.add_argument('--timeout', type=int, default=90)
    parser.add_argument('--token', help=argparse.SUPPRESS)
    args = parser.parse_args()
    if not 1 <= args.timeout <= 600:
        parser.error('timeout must be between 1 and 600 seconds')
    os.umask(0o077)
    try:
        if args.action == '_validator-worker':
            return validator_worker(args.environment, args.token)
        runtime = Runtime(args.environment)
        if args.action == 'inspect':
            result = runtime.inspect()
        elif args.action == 'stop':
            result = runtime.stop(timeout=args.timeout)
        else:
            result = runtime.start(resume=args.action == 'resume', timeout=args.timeout)
        print(json.dumps(result, indent=2))
        return 0
    except (RuntimeErrorDetail, OSError, ValueError, KeyError, subprocess.SubprocessError) as error:
        print(json.dumps({'schema': SCHEMA, 'ok': False, 'error': {
            'code': getattr(error, 'code', 'RUNTIME_INVALID'), 'message': str(error)}}))
        return 1


if __name__ == '__main__':
    sys.exit(main())
