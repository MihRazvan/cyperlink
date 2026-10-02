import base64
import copy
import importlib.util
import ipaddress
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import prepare_localnet as localnet


class PreparationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=ROOT / '.local')
        self.root = Path(self.temp.name)
        self.app = self.root / 'app'
        self.app.mkdir()

    def tearDown(self):
        self.temp.cleanup()

    def test_default_feature_set_unchanged_and_opt_in_targets_only_deployment_gate(self):
        with patch.object(localnet.subprocess, 'check_output') as help_call:
            self.assertEqual(localnet.validator_feature_options('/pinned/validator'), ([], []))
            help_call.assert_not_called()
        with patch.object(localnet.subprocess, 'check_output', return_value='--deactivate-feature <FEATURE_PUBKEY>...\n deactivate this feature in genesis.') as help_call:
            arguments, deviations = localnet.validator_feature_options('/pinned/validator', True)
        help_call.assert_called_once_with(['/pinned/validator', '--help'], text=True)
        self.assertEqual(arguments, ['--deactivate-feature', 'B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g'])
        self.assertEqual(len(deviations), 1)
        self.assertEqual(deviations[0]['feature'], arguments[1])
        self.assertEqual(deviations[0]['action'], 'deactivate-at-fresh-local-genesis')
        self.assertIn('not default Agave4.3.0 feature parity', deviations[0]['scope'])

    def test_feature_override_fails_if_exact_validator_option_is_unavailable(self):
        with patch.object(localnet.subprocess, 'check_output', return_value='different validator help'):
            with self.assertRaisesRegex(ValueError, 'does not support explicit genesis'):
                localnet.validator_feature_options('/pinned/validator', True)

    def peer(self, data):
        path = self.root / 'peer.json'
        path.write_text(json.dumps({'account': {'data': [base64.b64encode(data).decode(), 'base64']}}))
        return path

    def test_peer_patch_preserves_all_other_account_bytes(self):
        before = bytes(range(9)) + bytes([172, 20, 0, 99]) + bytes(range(32))
        path = self.peer(before)
        localnet.patch_peer(path, 9, '172.20.0.99', '172.29.0.99')
        actual = base64.b64decode(json.loads(path.read_text())['account']['data'][0])
        self.assertEqual(actual[:9], before[:9])
        self.assertEqual(actual[13:], before[13:])
        self.assertEqual(actual[9:13], bytes([172, 29, 0, 99]))

    def test_drifted_or_ambiguous_peer_layout_is_rejected_without_write(self):
        ip = bytes([172, 20, 0, 99])
        for data in [bytes(30), bytes(9) + ip + ip]:
            path = self.peer(data)
            before = path.read_bytes()
            with self.assertRaises(ValueError):
                localnet.patch_peer(path, 9, '172.20.0.99', '172.29.0.99')
            self.assertEqual(path.read_bytes(), before)

    def template(self, alter=lambda value: None):
        config = self.root / 'config'
        config.mkdir(exist_ok=True)
        data = json.loads((ROOT / 'config/local-compose.json').read_text())
        for service in data['services'].values():
            for mount in service['volumes']:
                if mount['read_only']:
                    target = self.app / mount['source']
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text('synthetic unit test input')
        alter(data)
        (config / 'local-compose.json').write_text(json.dumps(data))
        (config / 'local-toolchain.json').write_bytes((ROOT / 'config/local-toolchain.json').read_bytes())

    def test_compose_has_only_pinned_services_and_local_fresh_mounts(self):
        self.template()
        with patch.object(localnet, 'ROOT', self.root):
            result = localnet.compose_for(self.app, 'unit-test', ipaddress.ip_network('172.29.5.0/24'), 9191)
        self.assertEqual(len(result['services']), 3)
        for name, service in result['services'].items():
            self.assertIn('@sha256:', service['image'])
            self.assertEqual(service['pull_policy'], 'never')
            self.assertEqual(service['restart'], 'no')
            for mount in service['volumes']:
                self.assertTrue(Path(mount['source']).is_relative_to(self.app))
            for port in service.get('ports', []):
                self.assertEqual(port['host_ip'], '127.0.0.1')

    def test_compose_rejects_mutable_images_and_escaping_mounts(self):
        for change in [lambda d: d['services']['arx-node-0'].update(image='arcium/arx-node:latest'),
                       lambda d: d['services']['arx-node-0']['volumes'][0].update(source='../outside')]:
            self.template(change)
            with patch.object(localnet, 'ROOT', self.root), self.assertRaises(ValueError):
                localnet.compose_for(self.app, 'unit-test', ipaddress.ip_network('172.29.5.0/24'), 9191)

    def test_stale_runtime_shares_and_input_symlinks_are_rejected(self):
        self.template()
        d = json.loads((self.root / 'config/local-compose.json').read_text())
        node = d['services']['arx-node-0']
        runtime = self.app / next(m['source'] for m in node['volumes'] if not m['read_only'])
        runtime.mkdir(parents=True, exist_ok=True)
        (runtime / 'old-share').write_text('never reuse')
        with patch.object(localnet, 'ROOT', self.root), self.assertRaises(ValueError):
            localnet.compose_for(self.app, 'unit-test', ipaddress.ip_network('172.29.5.0/24'), 9191)
        (runtime / 'old-share').unlink()
        source = self.app / node['volumes'][0]['source']
        source.unlink()
        source.symlink_to(self.root / 'peer.json')
        with patch.object(localnet, 'ROOT', self.root), self.assertRaises(ValueError):
            localnet.compose_for(self.app, 'unit-test', ipaddress.ip_network('172.29.5.0/24'), 9191)


if __name__ == '__main__':
    unittest.main()
