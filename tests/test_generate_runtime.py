"""Generation-boundary checks; these tests do not claim MPC/validator execution."""
import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('generate_runtime', ROOT / 'scripts/generate_runtime.py')
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeBoundaryTests(unittest.TestCase):
    def test_artifact_pin_accepts_exact_bytes_and_rejects_mutation(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'artifact'
            path.write_bytes(b'qualified artifact')
            expected = hashlib.sha256(path.read_bytes()).hexdigest()
            self.assertEqual(runtime.checked_file(path, [expected]), path.resolve())
            path.write_bytes(b'changed artifact')
            with self.assertRaisesRegex(ValueError, 'Unqualified'):
                runtime.checked_file(path, [expected])

    def test_destination_rejects_outside_tree_existing_and_symlink_escape(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError, 'beneath'):
                runtime.require_new_local_output(Path(tmp) / 'new')
            local = ROOT / '.local'
            local.mkdir(exist_ok=True)
            with tempfile.TemporaryDirectory(dir=local) as inside:
                with self.assertRaisesRegex(ValueError, 'already exists'):
                    runtime.require_new_local_output(inside)
                escape = Path(inside) / 'escape'
                escape.symlink_to(tmp, target_is_directory=True)
                with self.assertRaisesRegex(ValueError, 'beneath'):
                    runtime.require_new_local_output(escape / 'new')

    def test_version_checks_are_stubs_but_launch_and_cleanup_never_execute(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            runtime.write_wrappers(out / 'bin')
            for name in ['anchor', 'solana-test-validator', 'docker']:
                check = subprocess.run([str(out / 'bin' / name), '--version'], capture_output=True)
                self.assertEqual(check.returncode, 0)
            launch = subprocess.run([str(out / 'bin/anchor'), 'localnet', '--skip-build', '--validator', 'legacy'], capture_output=True)
            self.assertEqual(launch.returncode, 77)
            cleanup = subprocess.run([str(out / 'bin/docker'), 'compose', '-f', 'artifacts/docker-compose-arx-env.yml', 'down', '--remove-orphans'], capture_output=True)
            self.assertEqual(cleanup.returncode, 77)
            self.assertEqual(len(runtime.validate_interceptions(out)), 5)

    def test_unexpected_network_or_process_command_is_blocked_and_fails_manifest(self):
        for name, args in [('solana', ['program', 'dump', '--url', 'mainnet-beta']),
                           ('docker', ['compose', 'up']), ('pkill', ['solana-test-validator'])]:
            with self.subTest(command=name), tempfile.TemporaryDirectory() as tmp:
                out = Path(tmp)
                runtime.write_wrappers(out / 'bin')
                subprocess.run([str(out / 'bin/anchor'), 'localnet', '--skip-build', '--validator', 'legacy'], capture_output=True)
                blocked = subprocess.run([str(out / 'bin' / name), *args], capture_output=True)
                self.assertEqual(blocked.returncode, 77)
                with self.assertRaisesRegex(ValueError, 'Unexpected blocked subprocess'):
                    runtime.validate_interceptions(out)

    def test_launch_marker_cannot_claim_success_without_exact_boundary(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp)
            (out / 'launch-intercepted.json').write_text(json.dumps({'command': 'anchor', 'args': ['test'], 'exit': 0}))
            with self.assertRaisesRegex(ValueError, 'Unexpected launch boundary'):
                runtime.validate_interceptions(out)

    def test_public_key_base58_keeps_leading_zeroes(self):
        self.assertEqual(runtime.pubkey(bytes(32)), '1' * 32)
        self.assertEqual(runtime.pubkey(bytes(31) + b'\x01'), '1' * 31 + '2')


if __name__ == '__main__':
    unittest.main()
