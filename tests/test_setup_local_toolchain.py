import base64
import hashlib
import io
import json
from pathlib import Path
import struct
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import setup_local_toolchain as setup
from verify_loaded_program import UPGRADEABLE


class ToolchainIntegrity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()

    def archive(self, members):
        path = self.root / "test.tar"
        with tarfile.open(path, "w") as tar:
            for name, kind, value in members:
                member = tarfile.TarInfo(name)
                member.type = kind
                if kind == tarfile.REGTYPE:
                    member.size = len(value)
                    tar.addfile(member, io.BytesIO(value))
                else:
                    member.linkname = value
                    tar.addfile(member)
        return path

    def test_archive_traversal_and_absolute_paths_rejected(self):
        for i, name in enumerate(("../escaped", "/tmp/escaped")):
            with self.subTest(name=name), self.assertRaises(ValueError):
                setup.extract(self.archive([(name, tarfile.REGTYPE, b"bad")]), self.root / str(i))
        self.assertFalse((self.root.parent / "escaped").exists())

    def test_members_under_symlink_rejected_before_writes(self):
        archive = self.archive([("link", tarfile.SYMTYPE, "safe"), ("link/payload", tarfile.REGTYPE, b"bad")])
        with self.assertRaisesRegex(ValueError, "beneath link"):
            setup.extract(archive, self.root / "out")
        self.assertEqual(list((self.root / "out").iterdir()), [])

    def test_escaping_symlink_and_hardlink_rejected(self):
        for i, kind in enumerate((tarfile.SYMTYPE, tarfile.LNKTYPE)):
            archive = self.archive([("link", kind, "../../escape")])
            with self.subTest(kind=kind), self.assertRaisesRegex(ValueError, "escapes"):
                setup.extract(archive, self.root / str(i))

    def test_devices_and_duplicate_members_rejected(self):
        for i, members in enumerate(([('device', tarfile.CHRTYPE, '')], [('file', tarfile.REGTYPE, b'a'), ('file', tarfile.REGTYPE, b'b')])):
            with self.subTest(i=i), self.assertRaises(ValueError):
                setup.extract(self.archive(members), self.root / str(i))

    def test_safe_internal_links_and_executable_files(self):
        archive = self.archive([("bin/tool", tarfile.REGTYPE, b"tool"), ("tool", tarfile.SYMTYPE, "bin/tool"), ("hard", tarfile.LNKTYPE, "bin/tool")])
        out = self.root / "out"
        setup.extract(archive, out)
        self.assertEqual((out / "tool").read_bytes(), b"tool")
        self.assertEqual((out / "hard").read_bytes(), b"tool")
        self.assertEqual(setup.inventory(out)["tool"], {"symlink": "bin/tool"})

    def test_corrupted_download_cache_is_not_reused(self):
        expected = hashlib.sha256(b"expected").hexdigest()
        (self.root / expected).write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "Cached asset hash mismatch"):
            setup.download({"sha256": expected}, self.root)

    def test_install_create_verify_corruption_and_missing_receipt(self):
        native, cache = self.root / "native", self.root / "cache"
        native.mkdir(); cache.mkdir()
        expected = hashlib.sha256(b"binary").hexdigest()
        (cache / expected).write_bytes(b"binary")
        asset = {"name": "tool", "format": "file", "path": "bin/tool", "sha256": expected}
        setup.install_asset(asset, native, cache)
        setup.install_asset(asset, native, cache, True)
        (native / "bin/tool").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "Installed asset changed"):
            setup.install_asset(asset, native, cache, True)
        (native / "receipts/tool.json").unlink()
        with self.assertRaisesRegex(ValueError, "Unverified installation"):
            setup.install_asset(asset, native, cache)

    def test_verify_only_does_not_install_missing_files(self):
        self.assertRaises(ValueError, setup.install_asset, {"name": "absent", "format": "file", "path": "bin/absent"}, self.root, self.root / "cache", True)
        self.assertFalse((self.root / "bin").exists())

    def sbf_cache_fixture(self):
        archive = self.root / "archive"
        archive.mkdir()
        home = self.root / "home"
        self.enterContext(patch.object(setup.Path, "home", return_value=home))
        for name, relative in setup.SBF_CACHE_LINKS.items():
            cache = home / ".cache/solana" / relative
            cache.mkdir(parents=True)
            link = archive / name
            link.parent.mkdir(parents=True, exist_ok=True)
            link.symlink_to(cache)
        return archive, home

    def test_only_exact_sbf_generated_cache_links_are_excluded(self):
        archive, _ = self.sbf_cache_fixture()
        self.assertEqual(setup.inventory(archive, sbf_runtime_cache=True), {})
        with self.assertRaisesRegex(ValueError, "symlink escapes"):
            setup.inventory(archive)
        for name, relative in setup.SBF_CACHE_LINKS.items():
            link = archive / name
            original = link.readlink()
            for target in (self.root / relative, original.parent.parent / "wrong" / original.name):
                target.mkdir(parents=True, exist_ok=True)
                link.unlink()
                link.symlink_to(target)
                with self.subTest(name=name, target=target), self.assertRaisesRegex(ValueError, "Unexpected SBF"):
                    setup.inventory(archive, sbf_runtime_cache=True)
            link.unlink()
            link.symlink_to(original)

    def test_missing_redirected_and_non_symlink_cache_targets_rejected(self):
        archive, _ = self.sbf_cache_fixture()
        for name in setup.SBF_CACHE_LINKS:
            link = archive / name
            target = link.readlink()
            target.rmdir()
            with self.subTest(name=name, kind="missing"), self.assertRaisesRegex(ValueError, "Unexpected SBF"):
                setup.inventory(archive, sbf_runtime_cache=True)
            elsewhere = self.root / target.name
            elsewhere.mkdir()
            target.symlink_to(elsewhere)
            with self.subTest(name=name, kind="redirected"), self.assertRaisesRegex(ValueError, "Unexpected SBF"):
                setup.inventory(archive, sbf_runtime_cache=True)
            target.unlink()
            target.mkdir()
            link.unlink()
            link.mkdir()
            with self.subTest(name=name, kind="directory"), self.assertRaisesRegex(ValueError, "Unexpected SBF"):
                setup.inventory(archive, sbf_runtime_cache=True)
            link.rmdir()
            link.symlink_to(target)

    def test_only_empty_regular_generated_markers_are_excluded(self):
        archive, _ = self.sbf_cache_fixture()
        for name in setup.SBF_CACHE_MARKERS:
            marker = archive / name
            marker.touch()
            self.assertEqual(setup.inventory(archive, sbf_runtime_cache=True), {})
            marker.write_bytes(b"unexpected")
            with self.subTest(name=name, kind="nonempty"), self.assertRaisesRegex(ValueError, "cache marker"):
                setup.inventory(archive, sbf_runtime_cache=True)
            marker.unlink()
            marker.symlink_to(archive / setup.SBF_CACHE_LINK)
            with self.subTest(name=name, kind="link"), self.assertRaisesRegex(ValueError, "cache marker"):
                setup.inventory(archive, sbf_runtime_cache=True)
            marker.unlink()
            marker.mkdir()
            with self.subTest(name=name, kind="directory"), self.assertRaisesRegex(ValueError, "cache marker"):
                setup.inventory(archive, sbf_runtime_cache=True)
            marker.rmdir()

    def test_cache_exception_does_not_allow_other_external_links(self):
        archive, home = self.sbf_cache_fixture()
        for name in ("criterion", f"{setup.SBF_DEPENDENCIES}/extra"):
            link = archive / name
            link.symlink_to(home / ".cache/solana/v2.3.2/criterion")
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "symlink escapes"):
                setup.inventory(archive, sbf_runtime_cache=True)
            link.unlink()

    def test_install_receipt_survives_generated_cache_but_rejects_release_changes(self):
        _, home = self.sbf_cache_fixture()
        native, cache = self.root / "native", self.root / "cache"
        native.mkdir(); cache.mkdir()
        tar = self.archive([("bin/tool", tarfile.REGTYPE, b"tool")])
        digest = setup.sha(tar)
        tar.rename(cache / digest)
        asset = {"name": "sbf-launcher", "format": "tar", "directory": "sbf", "sha256": digest}
        original = setup.install_asset(asset, native, cache)
        installed = native / "sbf"
        (installed / setup.SBF_DEPENDENCIES).mkdir(parents=True)
        for name, relative in setup.SBF_CACHE_LINKS.items():
            (installed / name).symlink_to(home / ".cache/solana" / relative)
        for name in setup.SBF_CACHE_MARKERS:
            (installed / name).touch()
        self.assertEqual(setup.install_asset(asset, native, cache, True), original)
        unexpected = installed / setup.SBF_DEPENDENCIES / "platform-tools-v1.57.md"
        unexpected.touch()
        with self.assertRaisesRegex(ValueError, "Installed asset changed"):
            setup.install_asset(asset, native, cache, True)
        unexpected.unlink()
        (installed / "bin/tool").write_bytes(b"changed")
        with self.assertRaisesRegex(ValueError, "Installed asset changed"):
            setup.install_asset(asset, native, cache, True)


class PublicArtifactIntegrity(unittest.TestCase):
    def setUp(self):
        self.payload = b"\x7fELFtest"
        self.spec = {"address": "program", "bytes": len(self.payload), "sha256": hashlib.sha256(self.payload).hexdigest()}
        self.program = self.account(struct.pack("<I", 2) + bytes([1]) * 32, True)
        self.data = self.account(struct.pack("<IQ", 3, 42) + bytes([1]) + bytes(32) + self.payload, False)

    def account(self, data, executable):
        return {"owner": UPGRADEABLE, "executable": executable, "data": [base64.b64encode(data).decode(), "base64"]}

    def rpc(self, method, params):
        if method == "getGenesisHash":
            return "genesis"
        return {"context": {"slot": 43}, "value": self.program if method == "getAccountInfo" else [self.program, self.data]}

    def test_exact_payload_and_authenticated_programdata(self):
        payload, report = setup.fetch_program(self.rpc, self.spec, "genesis")
        self.assertEqual(payload, self.payload)
        self.assertEqual(report["last_deploy_slot"], 42)

    def test_wrong_genesis_hash_and_length_drift_rejected(self):
        with self.assertRaisesRegex(ValueError, "genesis"):
            setup.fetch_program(self.rpc, self.spec, "wrong")
        self.spec["bytes"] += 1
        with self.assertRaisesRegex(ValueError, "length drift"):
            setup.fetch_program(self.rpc, self.spec, "genesis")

    def test_changed_hash_and_invalid_programdata_owner_rejected(self):
        self.spec["sha256"] = "0" * 64
        with self.assertRaisesRegex(ValueError, "hash drift"):
            setup.fetch_program(self.rpc, self.spec, "genesis")
        self.spec["sha256"] = hashlib.sha256(self.payload).hexdigest()
        self.data["owner"] = "wrong"
        with self.assertRaisesRegex(ValueError, "ProgramData owner"):
            setup.fetch_program(self.rpc, self.spec, "genesis")

    def test_public_rpc_has_fixed_endpoint_and_forbids_send(self):
        with self.assertRaises(ValueError):
            setup.PublicArtifactRpc("https://elsewhere.example")
        rpc = setup.PublicArtifactRpc("https://api.mainnet-beta.solana.com")
        for method in ("sendTransaction", "requestAirdrop", "simulateTransaction"):
            with self.subTest(method=method), self.assertRaisesRegex(ValueError, "method forbidden"):
                rpc(method, [])

    def test_changed_programdata_pointer_between_reads_is_rejected(self):
        def rpc(method, params):
            if method == "getMultipleAccounts":
                changed = self.account(struct.pack("<I", 2) + bytes([2]) * 32, True)
                return {"context": {"slot": 44}, "value": [changed, self.data]}
            return self.rpc(method, params)
        with self.assertRaisesRegex(ValueError, "pointer changed"):
            setup.fetch_program(rpc, self.spec, "genesis")


if __name__ == "__main__":
    unittest.main()
