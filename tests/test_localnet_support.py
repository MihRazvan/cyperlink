"""Local collision checks; Docker responses are mocked and nothing is launched."""
import ipaddress
import json
from pathlib import Path
import socket
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
import localnet_support as support


class LocalnetSupportTests(unittest.TestCase):
    def test_occupied_loopback_port_is_rejected_then_available_after_close(self):
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            listener.listen()
            port = listener.getsockname()[1]
            with self.assertRaisesRegex(RuntimeError, 'occupied'):
                support.available_port(port)
        support.available_port(port)

    def test_empty_docker_network_list_uses_first_candidate_without_inspection(self):
        with patch.object(support.subprocess, 'check_output', return_value='') as command:
            self.assertEqual(support.choose_subnet(None), ipaddress.ip_network('172.28.0.0/24'))
        command.assert_called_once_with(['docker', 'network', 'ls', '-q'], text=True)

    def test_automatic_selection_skips_enclosing_subnet_and_ignores_ipv6(self):
        networks = [
            {'IPAM': {'Config': [{'Subnet': '172.28.0.0/16'}, {'Subnet': 'fd00::/64'}]}},
            {'IPAM': {'Config': None}},
            {'IPAM': {'Config': [{'Gateway': '172.27.0.1'}]}},
        ]
        with patch.object(support.subprocess, 'check_output', side_effect=['one\ntwo\nthree\n', json.dumps(networks)]) as command:
            self.assertEqual(support.choose_subnet(None), ipaddress.ip_network('172.29.0.0/24'))
        self.assertEqual(command.call_args_list[1].args[0], ('docker', 'network', 'inspect', 'one', 'two', 'three'))

    def test_explicit_subnet_rejects_overlap_and_unsupported_ranges(self):
        networks = [{'IPAM': {'Config': [{'Subnet': '172.29.0.0/16'}]}}]
        with patch.object(support.subprocess, 'check_output', side_effect=['one\n', json.dumps(networks)]):
            with self.assertRaisesRegex(RuntimeError, 'overlaps'):
                support.choose_subnet('172.29.5.0/24')
        for subnet in ['8.8.8.0/24', '172.29.0.0/16', 'fd00::/64']:
            with self.subTest(subnet=subnet), patch.object(support.subprocess, 'check_output', return_value=''):
                with self.assertRaisesRegex(RuntimeError, 'private IPv4 /24'):
                    support.choose_subnet(subnet)

    def test_explicit_nonoverlapping_subnet_is_preserved(self):
        networks = [{'IPAM': {'Config': [{'Subnet': '172.28.0.0/24'}]}}]
        with patch.object(support.subprocess, 'check_output', side_effect=['one\n', json.dumps(networks)]):
            self.assertEqual(support.choose_subnet('172.29.5.0/24'), ipaddress.ip_network('172.29.5.0/24'))


if __name__ == '__main__':
    unittest.main()
