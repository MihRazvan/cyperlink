"""Tamper/ownership boundaries for the pinned JavaScript bootstrap; no installs."""
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
from unittest.mock import patch

REPO = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('setup_local_js', REPO / 'scripts/setup_local_js.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class LocalJsTests(unittest.TestCase):
    def setUp(self):
        (REPO / '.local').mkdir(exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='js-bootstrap-test-', dir=REPO / '.local')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.config = self.root / 'config'
        shutil.copytree(setup.CONFIG, self.config)

    def rewrite(self, name, value, repin=False):
        (self.config / name).write_text(json.dumps(value))
        if repin:
            provenance = json.loads((self.config / 'provenance.json').read_text())
            provenance['files'][name] = setup.sha256(self.config / name)
            (self.config / 'provenance.json').write_text(json.dumps(provenance))

    def staged(self):
        package, lock, provenance = setup.load_config(self.config)
        target = self.root / 'staged'
        target.mkdir()
        for filename in ['package.json', 'package-lock.json']:
            shutil.copyfile(self.config / filename, target / filename)
        for path, record in lock['packages'].items():
            if path:
                folder = target / path
                folder.mkdir(parents=True, exist_ok=True)
                (folder / 'package.json').write_text(json.dumps({'version': record['version']}))
        hidden = {'packages': {path: record for path, record in lock['packages'].items() if path}}
        (target / 'node_modules/.package-lock.json').write_text(json.dumps(hidden))
        return target, package, lock, provenance

    def test_committed_extraction_has_exact_direct_versions_and_frozen_entries(self):
        package, lock, provenance = setup.load_config(self.config)
        self.assertEqual(package['dependencies'], {'@anchor-lang/core': '1.2.0', '@arcium-hq/client': '0.15.0', '@solana/web3.js': '1.99.0', 'bn.js': '5.2.5'})
        self.assertEqual(len(lock['packages']) - 1, 67)
        self.assertEqual(provenance['original_lock_sha256'], 'b4f75537d61d0cd2c7a3e9dcec12753d3676845d3f9868413350a1ce7f7eedec')

    def test_detects_manifest_and_lock_tampering(self):
        for name in ['package.json', 'package-lock.json']:
            with self.subTest(name=name):
                original = (self.config / name).read_bytes()
                (self.config / name).write_bytes(original + b' ')
                with self.assertRaisesRegex(ValueError, 'provenance hash mismatch'):
                    setup.load_config(self.config)
                (self.config / name).write_bytes(original)

    def test_even_rehashed_unpinned_or_wrong_root_dependencies_fail(self):
        package = json.loads((self.config / 'package.json').read_text())
        package['dependencies']['bn.js'] = '^5.2.5'
        self.rewrite('package.json', package, repin=True)
        with self.assertRaisesRegex(ValueError, 'pins disagree'):
            setup.load_config(self.config)

    def test_installed_version_drift_and_tarball_integrity_drift_fail(self):
        target, package, lock, provenance = self.staged()
        self.assertEqual(setup.check_installed(target, package, lock, provenance)['checked_packages'], 67)
        manifest = target / 'node_modules/bn.js/package.json'
        manifest.write_text(json.dumps({'version': '5.2.6'}))
        with self.assertRaisesRegex(ValueError, 'version drift'):
            setup.check_installed(target, package, lock, provenance)
        manifest.write_text(json.dumps({'version': '5.2.5'}))
        path = target / 'node_modules/.package-lock.json'
        hidden = json.loads(path.read_text())
        hidden['packages']['node_modules/bn.js']['integrity'] = 'sha512-wrong'
        path.write_text(json.dumps(hidden))
        with self.assertRaisesRegex(ValueError, 'integrity/version'):
            setup.check_installed(target, package, lock, provenance)

    def test_installed_unknown_packages_fail(self):
        target, package, lock, provenance = self.staged()
        path = target / 'node_modules/.package-lock.json'
        hidden = json.loads(path.read_text())
        hidden['packages']['node_modules/not-in-reviewed-lock'] = {'version': '1.0.0'}
        path.write_text(json.dumps(hidden))
        with self.assertRaisesRegex(ValueError, 'outside the pinned lock'):
            setup.check_installed(target, package, lock, provenance)

    def test_symlinked_package_escape_fails(self):
        target, package, lock, provenance = self.staged()
        path = target / 'node_modules/bn.js'
        elsewhere = self.root / 'original-research-package'
        path.rename(elsewhere)
        path.symlink_to(elsewhere, target_is_directory=True)
        with self.assertRaisesRegex(ValueError, 'escapes local environment'):
            setup.check_installed(target, package, lock, provenance)

    def test_unknown_existing_dependency_tree_is_never_overwritten(self):
        repo = self.root / 'repo'
        target = repo / '.local/toolchain/js'
        (target / 'node_modules').mkdir(parents=True)
        with patch.object(setup, 'REPO', repo), patch.object(setup, 'TARGET', target):
            with self.assertRaisesRegex(ValueError, 'unmanaged node_modules'):
                setup.ensure_private_destination(target)


if __name__ == '__main__':
    unittest.main()
