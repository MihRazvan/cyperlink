"""Host lifecycle tests. Synthetic fixtures do not establish validator/MPC execution."""
import base64
import copy
import json
import os
import socket
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import runtime_local as module


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.local')
        self.directory = Path(self.temp.name)
        self.app = self.directory / 'app'
        self.app.mkdir()
        (self.app / 'artifacts').mkdir()
        self.validator = self.directory / 'validator'
        self.validator.write_text('synthetic executable')
        self.elf = self.app / 'program.so'
        self.elf.write_bytes(b'\x7fELFsynthetic')
        self.genesis = self.app / 'genesis-account.json'
        self.genesis.write_text('{}')
        (self.app / 'generation.json').write_text('{}')
        self.argv = [str(self.validator), '--ledger', str(self.app / 'ledger'),
                     '--bind-address', '127.0.0.1', '--rpc-port', '18995', '--faucet-port', '19910']
        (self.app / 'validator-command.json').write_text(json.dumps(self.argv))
        services = {}
        for name in ['arcium-trusted-dealer', 'arx-node-0', 'arx-node-1']:
            identity = self.app / 'artifacts' / f'{name}.key'
            identity.write_text('synthetic identity')
            volume = self.app / 'artifacts' / f'{name}-shares'
            volume.mkdir()
            services[name] = {'image': f'{name}@sha256:synthetic', 'pull_policy': 'never', 'restart': 'no',
                              'volumes': [{'source': str(identity), 'target': '/identity', 'read_only': True},
                                          {'source': str(volume), 'target': '/shares', 'read_only': False}]}
        self.compose = {'name': 'cyperlink-runtime-host-test', 'services': services}
        (self.app / 'artifacts/compose.json').write_text(json.dumps(self.compose))
        self.preparation = {'app': str(self.app), 'rpc': 'http://127.0.0.1:18995',
                            'compose_project': self.compose['name'], 'validator_sha256': module.sha256(self.validator),
                            'deployments': [{'address': 'synthetic-program', 'elf': str(self.elf),
                                             'sha256': module.sha256(self.elf), 'upgradeable': False}],
                            'staged_public_genesis': [{'path': str(self.genesis), 'staged_sha256': module.sha256(self.genesis)}]}
        (self.directory / 'preparation.json').write_text(json.dumps(self.preparation))
        self.pins = {'executables': {'validator': {'sha256': module.sha256(self.validator)}},
                     'docker_images': {name: service['image'] for name, service in services.items()}}
        original = module.read_json
        self.patcher = patch.object(module, 'read_json', side_effect=lambda path:
                                    copy.deepcopy(self.pins) if Path(path) == ROOT / 'config/local-toolchain.json' else original(path))
        self.patcher.start()
        self.runtime = module.Runtime(self.directory)

    def tearDown(self):
        self.patcher.stop()
        self.temp.cleanup()

    def enroll(self):
        self.runtime.state = {'schema': module.SCHEMA, 'runtime_id': 'synthetic-runtime',
                              'inputs': self.runtime.inputs(), 'phase': 'stopped', 'genesis': 'same-genesis',
                              'validator': None, 'containers': {}}
        ledger = self.app / 'ledger'
        ledger.mkdir()
        (ledger / 'genesis.bin').write_bytes(b'synthetic genesis')
        for name in ['validator-keypair.json', 'vote-account-keypair.json', 'stake-account-keypair.json', 'faucet-keypair.json']:
            (ledger / name).write_text('synthetic identity')
        self.runtime.state['genesis_file_sha256'] = module.sha256(ledger / 'genesis.bin')
        self.runtime.save()

    def containers(self, running=False):
        return [{'Id': f'container-{name}', 'Config': {'Image': service['image'], 'Labels': {
            'io.cyperlink.runtime': 'synthetic-runtime', 'com.docker.compose.service': name}},
            'Mounts': [{'Source': item['source'], 'Destination': item['target'], 'RW': not item['read_only']}
                       for item in service['volumes']],
            'State': {'Running': running, 'Status': 'running' if running else 'exited'}}
            for name, service in self.compose['services'].items()]

    def test_input_snapshot_retains_identity_but_allows_share_content_evolution(self):
        self.enroll()
        share = self.app / 'artifacts/arx-node-0-shares/new-share'
        share.write_text('mutable state')
        self.runtime.verify_inputs()
        (self.app / 'artifacts/arx-node-0.key').write_text('changed identity')
        with self.assertRaisesRegex(module.RuntimeErrorDetail, 'identities'):
            self.runtime.verify_inputs()

    def test_replaced_retained_directory_rejected_even_if_empty(self):
        self.enroll()
        volume = self.app / 'artifacts/arx-node-0-shares'
        volume.rename(volume.with_name('retained-original'))
        volume.mkdir()
        with self.assertRaisesRegex(module.RuntimeErrorDetail, 'retained directories'):
            self.runtime.verify_inputs()

    def test_missing_volume_is_not_recreated(self):
        self.enroll()
        volume = self.app / 'artifacts/arx-node-0-shares'
        volume.rmdir()
        with self.assertRaisesRegex(module.RuntimeErrorDetail, 'missing'):
            self.runtime.verify_inputs()
        self.assertFalse(volume.exists())

    def test_changed_genesis_rejected(self):
        self.enroll()
        (self.app / 'ledger/genesis.bin').write_bytes(b'replacement')
        with self.assertRaisesRegex(module.RuntimeErrorDetail, 'genesis file changed'):
            self.runtime.verify_inputs()

    def test_unmanaged_existing_ledger_cannot_be_adopted(self):
        (self.app / 'ledger').mkdir()
        with self.assertRaisesRegex(module.RuntimeErrorDetail, 'managed first start'):
            self.runtime.start()
        self.assertFalse(self.runtime.state_path.exists())

    def test_resume_cannot_recreate_missing_retained_ledger(self):
        self.enroll()
        (self.app / 'ledger/genesis.bin').unlink()
        for path in (self.app / 'ledger').iterdir():
            path.unlink()
        (self.app / 'ledger').rmdir()
        with self.assertRaises(module.RuntimeErrorDetail):
            self.runtime.start(resume=True)
        self.assertFalse((self.app / 'ledger').exists())

    def test_changed_elf_and_validator_pin_rejected(self):
        self.elf.write_bytes(b'changed')
        with self.assertRaisesRegex(module.RuntimeErrorDetail, 'ELF differs'):
            self.runtime.inputs()
        self.validator.write_text('different executable')
        with self.assertRaisesRegex(module.RuntimeErrorDetail, 'pinned artifact'):
            self.runtime.inputs()

    def test_cannot_stop_unowned_or_replaced_container(self):
        self.enroll()
        records = self.containers()
        records[0]['Config']['Labels']['io.cyperlink.runtime'] = 'another-runtime'
        with patch.object(self.runtime, 'containers', return_value=records), patch.object(module, 'command') as run:
            with self.assertRaisesRegex(module.RuntimeErrorDetail, 'not owned'):
                self.runtime.stop()
            run.assert_not_called()
        records = self.containers()
        self.runtime.state['containers'] = {'arcium-trusted-dealer': 'original-container'}
        with patch.object(self.runtime, 'containers', return_value=records):
            with self.assertRaisesRegex(module.RuntimeErrorDetail, 'replaced'):
                self.runtime.owned_containers()

    def test_missing_retained_container_does_not_get_recreated(self):
        self.enroll()
        self.runtime.state['containers'] = {'arx-node-0': 'original-container'}
        with patch.object(self.runtime, 'containers', return_value=[]):
            with self.assertRaisesRegex(module.RuntimeErrorDetail, 'missing'):
                self.runtime.owned_containers()

    def test_pid_reuse_cannot_stop_an_unrelated_process(self):
        self.enroll()
        self.runtime.state['validator'] = {'pid': 9999, 'started': 'original-start'}
        self.runtime.save()
        with patch.object(self.runtime, 'containers', return_value=[]), \
             patch.object(module, 'process_identity', return_value={'pid': 9999, 'started': 'different-start', 'command': 'unrelated'}), \
             patch.object(module.os, 'kill') as kill:
            with self.assertRaisesRegex(module.RuntimeErrorDetail, 'does not identify'):
                self.runtime.stop()
            kill.assert_not_called()

    def test_stop_uses_exact_container_ids_and_never_removes_volumes(self):
        self.enroll()
        records = self.containers(True)
        stopped = self.containers(False)
        with patch.object(self.runtime, 'containers', side_effect=[records, stopped, stopped]), patch.object(module, 'command') as run:
            result = self.runtime.stop()
        run.assert_called_once_with(['docker', 'kill', '--signal=SIGTERM', *[item['Id'] for item in records]])
        self.assertEqual(result['state'], 'stopped')
        self.assertFalse(result['ready'])
        self.assertTrue((self.app / 'ledger/genesis.bin').exists())

    def test_resume_uses_original_containers_and_genesis(self):
        self.enroll()
        records = self.containers(True)
        self.runtime.state['containers'] = {item['Config']['Labels']['com.docker.compose.service']: item['Id'] for item in records}
        self.runtime.save()
        chain = {'genesis': 'same-genesis', 'loaded_programs': ['synthetic-program']}
        with patch.object(self.runtime, 'containers', return_value=records), \
             patch.object(module, 'process_owned', return_value=True), \
             patch.object(self.runtime, 'verify_chain', return_value=chain), patch.object(module, 'command') as run:
            result = self.runtime.start(resume=True)
        self.assertTrue(result['ready'])
        self.assertEqual(result['genesis'], 'same-genesis')
        run.assert_called_once_with(['docker', 'start', *self.runtime.state['containers'].values()], timeout=60)

    def test_after_container_create_interruption_owned_containers_are_discovered(self):
        self.enroll()
        self.runtime.state['phase'] = 'starting-services'
        self.runtime.save()
        records = self.containers(True)
        chain = {'genesis': 'same-genesis', 'loaded_programs': []}
        with patch.object(self.runtime, 'containers', return_value=records), \
             patch.object(module, 'process_owned', return_value=True), \
             patch.object(self.runtime, 'verify_chain', return_value=chain), patch.object(module, 'command') as run:
            self.runtime.start(resume=True)
        self.assertEqual(len(self.runtime.state['containers']), 3)
        self.assertEqual(run.call_count, 1)
        self.assertEqual(run.call_args.args[0][1], 'start')

    def test_rpc_genesis_mismatch_prevents_loaded_program_acceptance(self):
        self.enroll()
        with patch.object(self.runtime, 'rpc', return_value='other-genesis'):
            with self.assertRaisesRegex(module.RuntimeErrorDetail, 'does not match'):
                self.runtime.verify_chain()

    def test_loaded_elf_requires_exact_bytes_not_only_executable_flag(self):
        self.enroll()
        def rpc(method, params=None):
            return 'same-genesis' if method == 'getGenesisHash' else {'solana-core': '4.3.0'}
        with patch.object(self.runtime, 'rpc', side_effect=rpc), patch.object(self.runtime, 'account', return_value={
            'executable': True, 'owner': 'BPFLoader2111111111111111111111111111111111', 'data': [base64.b64encode(b'wrong ELF').decode(), 'base64']}):
            with self.assertRaisesRegex(module.RuntimeErrorDetail, 'Actual loaded'):
                self.runtime.verify_chain()
        with patch.object(self.runtime, 'rpc', side_effect=rpc), patch.object(self.runtime, 'account', return_value={
            'executable': True, 'owner': 'BPFLoader2111111111111111111111111111111111', 'data': [base64.b64encode(self.elf.read_bytes()).decode(), 'base64']}):
            self.assertEqual(self.runtime.verify_chain()['loaded_programs'], ['synthetic-program'])

    def test_read_only_inspection_does_not_enroll_or_create_lock(self):
        with patch.object(self.runtime, 'containers', return_value=[]):
            result = self.runtime.inspect()
        self.assertEqual(result['state'], 'prepared')
        self.assertFalse(self.runtime.state_path.exists())
        self.assertFalse((self.directory / 'runtime.lock').exists())

    def test_lock_releases_after_exception_and_blocks_competing_mutation(self):
        with self.runtime.lock():
            with self.assertRaisesRegex(module.RuntimeErrorDetail, 'Another runtime'):
                with self.runtime.lock():
                    pass
        with self.runtime.lock():
            pass

    def test_atomic_journal_has_private_permissions(self):
        self.enroll()
        self.assertEqual(self.runtime.state_path.stat().st_mode & 0o777, 0o600)
        self.assertEqual(module.read_json(self.runtime.state_path)['schema'], module.SCHEMA)

    def test_process_ownership_checks_creation_time_and_exact_command(self):
        record = {'pid': 123, 'started': 'same-time'}
        with patch.object(module, 'process_identity', return_value={**record, 'command': ' '.join(self.argv)}):
            self.assertTrue(module.process_owned(record, self.argv))
        with patch.object(module, 'process_identity', return_value={**record, 'command': 'unrelated'}):
            self.assertFalse(module.process_owned(record, self.argv))
        with patch.object(module, 'process_identity', return_value={**record, 'started': 'new-time', 'command': ' '.join(self.argv)}):
            self.assertFalse(module.process_owned(record, self.argv))

    def test_immutable_cli_program_still_decodes_actual_upgradeable_loader(self):
        self.enroll()
        program = {'executable': True, 'owner': module.LOADER,
                   'data': [base64.b64encode(b'\2\0\0\0' + bytes(range(32))).decode(), 'base64']}
        data = {'owner': module.LOADER, 'data': [base64.b64encode(
            b'\3\0\0\0' + bytes(41) + self.elf.read_bytes()).decode(), 'base64']}
        with patch.object(self.runtime, 'rpc', side_effect=lambda method, params=None:
                          'same-genesis' if method == 'getGenesisHash' else {'solana-core': '4.3.0'}), \
             patch.object(self.runtime, 'account', side_effect=[program, data]):
            self.assertEqual(self.runtime.verify_chain()['loaded_programs'], ['synthetic-program'])

    def test_worker_cannot_exec_without_durable_matching_launch_token(self):
        self.enroll()
        self.runtime.state['launch_token'] = 'original-token'
        self.runtime.save()
        with patch.object(module.os, 'execv') as execute:
            self.assertEqual(module.validator_worker(self.directory, 'another-token'), 1)
            execute.assert_not_called()

    def test_worker_requires_recorded_pid_before_exec(self):
        self.enroll()
        self.runtime.state['launch_token'] = 'original-token'
        self.runtime.state['validator'] = None
        self.runtime.save()
        with patch.object(module.time, 'monotonic', side_effect=[0, 0, 20]), \
             patch.object(module.time, 'sleep'), patch.object(module.os, 'execv') as execute:
            self.assertEqual(module.validator_worker(self.directory, 'original-token'), 1)
            execute.assert_not_called()

    def test_mutation_reloads_latest_journal_after_acquiring_lock(self):
        self.enroll()
        stale = module.Runtime(self.directory)
        self.runtime.state['runtime_id'] = 'newer-controller-identity'
        self.runtime.save()
        with stale.lock():
            self.assertEqual(stale.state['runtime_id'], 'newer-controller-identity')

    def test_container_identity_includes_actual_retained_mounts(self):
        self.enroll()
        records = self.containers()
        records[0]['Mounts'][0]['Source'] = '/different/identity'
        with patch.object(self.runtime, 'containers', return_value=records):
            with self.assertRaisesRegex(module.RuntimeErrorDetail, 'mounts differ'):
                self.runtime.owned_containers()

    def test_resume_port_probe_accepts_closed_rpc_time_wait_but_rejects_listener(self):
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(('127.0.0.1', 0))
        listener.listen(1)
        port = listener.getsockname()[1]
        client = socket.socket()
        try:
            client.connect(('127.0.0.1', port))
            connection, _ = listener.accept()
            self.runtime.port = port
            self.runtime.argv = ['validator', '--faucet-port', str(port)]
            with self.assertRaisesRegex(module.RuntimeErrorDetail, 'occupied'):
                self.runtime.ensure_ports()
            connection.shutdown(socket.SHUT_RDWR)
            connection.close()
            self.assertEqual(client.recv(1), b'')
            client.close()
            listener.close()
            # The server-side connection was actively closed and may be in
            # TIME_WAIT. An immediate restart probe must succeed without sleeps.
            self.runtime.ensure_ports()
        finally:
            client.close()
            listener.close()


if __name__ == '__main__':
    unittest.main()
