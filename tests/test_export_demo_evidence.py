import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('export_demo_evidence', ROOT / 'scripts/export_demo_evidence.py')
exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(exporter)


class PublicEvidenceExport(unittest.TestCase):
    def fixture(self):
        raw = {'schema_version': 1, 'passed': True, 'scenario': 'conflict',
               'operations': [], 'finalQuota': {'version': '1', 'stateHash': 'a' * 64, 'nonce': 'b' * 32, 'ciphertext': 'c' * 64, 'counter': '4'},
               'validatorCostByCategory': {'native-settlement': {'transactions': 1, 'landedCU': 10, 'feeLamports': 5000}},
               'transactions': [{'label': 'commit', 'category': 'native-settlement', 'signature': 'signature', 'error': None}],
               'callbacks': [{'label': 'callback', 'output': {'field0': True, 'field1': [1, 2]}}],
               'checks': [{'label': 'observed', 'observation': {'status': 'committed'}}],
               'accountSnapshots': [{'label': 'before', 'context': {'slot': 4}, 'commitment': 'confirmed', 'accounts': [{'address': 'public-address', 'owner': 'public-owner', 'executable': False, 'lamports': 10, 'dataBase64': 'AQID'}]}]}
        prep = {'bootstrap': 'fresh-upstream-generated', 'research_checkout_required': False}
        source = {'commit': 'a' * 40, 'files': {'programs/native/guard/src/lib.rs': 'b' * 64}}
        return raw, prep, source

    def report(self, raw=None):
        initial, prep, source = self.fixture()
        return exporter.build_report(raw or initial, prep, source, [], [{'job': 'job', 'secretKey': 'SENSITIVE_SENTINEL'}], {})

    def test_sensitive_unknown_fields_omitted_at_every_level(self):
        raw, _, _ = self.fixture()
        def inject(value):
            if isinstance(value, dict):
                for child in list(value.values()): inject(child)
                value['privateAccountKey'] = 'SENSITIVE_SENTINEL'
            elif isinstance(value, list):
                for child in value: inject(child)
        inject(raw)
        raw['transactions'][0]['transaction'] = {'wire': 'SENSITIVE_SENTINEL'}
        raw['transactions'][0]['logs'] = ['SENSITIVE_SENTINEL']
        raw['checks'][0]['logs'] = ['SENSITIVE_SENTINEL']
        result = self.report(raw)
        serialized = json.dumps(result)
        self.assertNotIn('SENSITIVE_SENTINEL', serialized)
        self.assertNotIn('privateAccountKey', serialized)
        self.assertEqual(result['final_quota']['ciphertext'], 'c' * 64)
        self.assertEqual(result['accountSnapshots'][0]['accounts'][0]['dataBase64'], 'AQID')

    def test_output_is_create_only(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'report.json'
            exporter.write_report(path, self.report())
            original = path.read_bytes()
            with self.assertRaises(FileExistsError):
                exporter.write_report(path, {'passed': False})
            self.assertEqual(path.read_bytes(), original)

    def test_failed_and_incomplete_run_cannot_export(self):
        for passed in (False, None, 1, 'true'):
            raw, _, _ = self.fixture(); raw['passed'] = passed
            with self.subTest(passed=passed), self.assertRaisesRegex(ValueError, 'completed passing'):
                self.report(raw)

    def test_fixture_bootstrap_cannot_claim_fresh_generation(self):
        raw, prep, source = self.fixture(); prep['bootstrap'] = 'archived'
        with self.assertRaisesRegex(ValueError, 'fresh generated'):
            exporter.build_report(raw, prep, source, [], [], {})

    def test_public_snapshots_remain_exact_when_no_unknown_fields(self):
        raw, _, _ = self.fixture()
        self.assertEqual(self.report(raw)['accountSnapshots'], raw['accountSnapshots'])

    def test_upload_cost_retained_but_raw_upload_transaction_excluded(self):
        raw, _, _ = self.fixture()
        raw['transactions'].append({'category': 'arcium-circuit-upload', 'transaction': {'secret': 'SENSITIVE_SENTINEL'}})
        raw['validatorCostByCategory']['arcium-circuit-upload'] = {'transactions': 1, 'landedCU': 50, 'feeLamports': 5000}
        result = self.report(raw)
        self.assertEqual(len(result['critical_transactions']), 1)
        self.assertEqual(result['validator_cost_by_category']['arcium-circuit-upload']['landedCU'], 50)

    def test_custom_error_does_not_copy_extra_nested_fields(self):
        result = exporter.error_summary({'InstructionError': [1, {'Custom': 705, 'secret': 'SENSITIVE_SENTINEL'}], 'secret': 'SENSITIVE_SENTINEL'})
        self.assertEqual(result, {'InstructionError': [1, {'Custom': 705}]})

    def test_final_sdk_buffer_snapshot_is_explicitly_summary_only(self):
        result = exporter.summarize_final_accounts({'scope': 'independent',
            'observations': [{'name': 'a40', 'observation': {'status': 'committed', 'secret': 'SENSITIVE_SENTINEL'}}],
            'snapshot': {'slot': 342, 'commitment': 'confirmed', 'accounts': [{'data': {'type': 'Buffer', 'data': [1, 2, 3]}, 'secret': 'SENSITIVE_SENTINEL'}]}})
        self.assertEqual(result['snapshot_summary']['account_count'], 1)
        self.assertEqual(result['snapshot_summary']['slot'], 342)
        self.assertNotIn('snapshot', result)
        self.assertNotIn('SENSITIVE_SENTINEL', json.dumps(result))

    def test_recovery_allowlist_retains_binding_and_actual_error_without_wire_or_keys(self):
        raw, _, _ = self.fixture()
        raw['recoveries'] = [{'label': 'delayed-query-rejected', 'passed': True, 'processId': 200,
            'action': 'recover-ticket', 'retainedPlan': {'sha256': 'a' * 64, 'bytes': 100, 'secret': 'SENSITIVE_SENTINEL'},
            'delivery': {'status': 'failed', 'signature': 'signature', 'role': 'query', 'wireSha256': 'b' * 64,
                'record': {'wireBase64': 'SENSITIVE_SENTINEL'}, 'wireBase64': 'SENSITIVE_SENTINEL',
                'semanticBinding': {'instructionSha256': 'c' * 64, 'secret': 'SENSITIVE_SENTINEL'},
                'receipt': {'slot': 42, 'landedCU': 400, 'feeLamports': 5000,
                    'error': {'InstructionError': [1, {'Custom': 6004, 'secret': 'SENSITIVE_SENTINEL'}]},
                    'logs': ['SENSITIVE_SENTINEL']}},
            'observation': {'status': 'unobserved', 'privateKey': 'SENSITIVE_SENTINEL'}}]
        result = self.report(raw)
        self.assertNotIn('SENSITIVE_SENTINEL', json.dumps(result))
        self.assertEqual(result['recoveries'][0]['delivery']['receipt']['error'], {'InstructionError': [1, {'Custom': 6004}]})
        self.assertEqual(result['recoveries'][0]['observation']['status'], 'unobserved')
        self.assertIn('deliberate test fault injection', result['recovery_evidence_scope'])

    def test_prepared_action_evidence_preserves_public_bytes_and_drops_unknown_private_fields(self):
        raw, _, _ = self.fixture()
        evidence = {'address': 'prepared-action', 'owner': 'auth', 'executable': False,
                    'slot': 42, 'dataBase64': 'AQID', 'sha256': 'a' * 64}
        raw['recoveries'] = [{'delivery': {'semanticBinding': {'preparedAction': evidence | {
            'privateKey': 'SENSITIVE_SENTINEL', 'wire': 'SENSITIVE_SENTINEL', 'logs': ['SENSITIVE_SENTINEL']}}}}]
        result = self.report(raw)
        self.assertEqual(result['recoveries'][0]['delivery']['semanticBinding']['preparedAction'], evidence)
        self.assertNotIn('SENSITIVE_SENTINEL', json.dumps(result))

    def test_query_snapshot_rejection_preserves_null_absence_and_public_bytes(self):
        raw, _, _ = self.fixture()
        snapshot = {'slot': 42, 'accounts': [
            {'address': 'quota', 'owner': 'program', 'lamports': 3, 'executable': False, 'dataBase64': 'AQID'},
            {'address': 'permit', 'owner': 'program', 'lamports': 4, 'executable': False, 'dataBase64': 'AAAA'}, None, None, None]}
        raw['querySnapshotRejection'] = {'actualCustomError': 6004, 'signature': 'signature',
            'trackedAddresses': ['quota', 'permit', 'job', 'computation', 'claim'],
            'before': snapshot, 'after': snapshot, 'exactSignedWireReused': True,
            'jobPermitClaimAndComputationAbsent': True, 'quotaAndPermitUnchanged': True,
            'descriptor': {'queryStateHashHex': 'd' * 64, 'privateKey': 'SENSITIVE_SENTINEL'},
            'privateKey': 'SENSITIVE_SENTINEL'}
        result = self.report(raw)['querySnapshotRejection']
        self.assertEqual(result['before'], snapshot)
        self.assertEqual(result['after']['accounts'][2:], [None, None, None])
        self.assertEqual(result['descriptor']['queryStateHashHex'], 'd' * 64)
        self.assertNotIn('SENSITIVE_SENTINEL', json.dumps(result))

    def test_extended_source_snapshots_remain_public_hash_records(self):
        raw, preparation, sources = self.fixture()
        clients = [{'path': 'packages/local-client/src/operation-client.mjs', 'sha256': 'c' * 64, 'bytes': 10, 'sourcePrivateKey': 'SENSITIVE_SENTINEL'},
                   {'path': 'examples/two-consumers/recover-operation.mjs', 'sha256': 'd' * 64, 'bytes': 20}]
        result = exporter.build_report(raw, preparation, sources, clients, [{'queryStateHashHex': 'e' * 64}], {})
        self.assertEqual(len(result['executed_client_source_manifest']), 2)
        self.assertEqual(result['locally_retained_operation_descriptors'][0]['queryStateHashHex'], 'e' * 64)
        self.assertNotIn('SENSITIVE_SENTINEL', json.dumps(result))


if __name__ == '__main__':
    unittest.main()
