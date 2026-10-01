"""Integrity regression tests; actual compiler execution is recorded separately."""
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("rebuild_circuits", ROOT / "scripts/rebuild_circuits.py")
rebuild = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rebuild)


class CircuitArtifacts(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / "artifacts"
        self.path.mkdir()
        self.baseline = json.loads((ROOT / "circuits/budget/baseline.json").read_text())
        for name in self.baseline["artifacts"]:
            shutil.copyfile(ROOT / "programs/auth/build" / name, self.path / name)

    def test_reviewed_baseline_and_native_hashes_agree(self):
        self.assertEqual(len(rebuild.check_artifacts(self.path, self.baseline)), 8)

    def test_single_byte_corruption_in_every_artifact_is_rejected(self):
        for name in self.baseline["artifacts"]:
            with self.subTest(name=name):
                path = self.path / name
                original = path.read_bytes()
                path.write_bytes(bytes([original[0] ^ 1]) + original[1:])
                with self.assertRaisesRegex(ValueError, "artifact mismatch"):
                    rebuild.check_artifacts(self.path, self.baseline)
                path.write_bytes(original)

    def test_missing_initializer_is_not_accepted_as_bound_only_success(self):
        (self.path / "runtime_budget_init.arcis").unlink()
        with self.assertRaises(FileNotFoundError):
            rebuild.check_artifacts(self.path, self.baseline)

    def test_hash_file_must_authenticate_circuit_even_if_manifest_is_updated(self):
        path = self.path / "runtime_budget_bound.hash"
        values = json.loads(path.read_text())
        values[0] ^= 1
        path.write_text(json.dumps(values))
        self.baseline["artifacts"][path.name] = rebuild.digest(path)
        with self.assertRaisesRegex(ValueError, "native hash does not authenticate"):
            rebuild.check_artifacts(self.path, self.baseline)

    def test_boolean_hash_bytes_are_not_accepted(self):
        path = self.path / "runtime_budget_init.hash"
        path.write_text(json.dumps([False] * 32))
        self.baseline["artifacts"][path.name] = rebuild.digest(path)
        with self.assertRaisesRegex(ValueError, "invalid native hash"):
            rebuild.check_artifacts(self.path, self.baseline)

    def test_staging_excludes_build_artifacts_and_rejects_reused_directory(self):
        source = Path(self.tmp.name) / "source"
        source.mkdir()
        (source / "src").mkdir()
        for name in ("Cargo.lock", "Cargo.toml", "src/main.rs"):
            (source / name).write_text("source")
        (source / "build").mkdir()
        (source / "build/stale.arcis").write_text("cached circuit must never be reused")
        output = Path(self.tmp.name) / "fresh"
        staged = rebuild.stage(source, output)
        self.assertFalse((staged / "build").exists())
        self.assertEqual((staged / "Cargo.lock").read_text(), "source")
        with self.assertRaises(FileExistsError):
            rebuild.stage(source, output)


if __name__ == "__main__":
    unittest.main()
