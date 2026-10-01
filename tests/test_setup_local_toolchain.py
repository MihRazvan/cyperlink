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

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import setup_local_toolchain as setup
from verify_loaded_program import UPGRADEABLE


class ToolchainIntegrity(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

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

    def test_only_exact_sbf_generated_cache_link_is_excluded(self):
        archive = self.root / "archive"
        archive.mkdir()
        cache = self.root / "v1.57/platform-tools"
        cache.mkdir(parents=True)
        link = archive / setup.SBF_CACHE_LINK
        link.parent.mkdir(parents=True)
        link.symlink_to(cache)
        self.assertEqual(setup.inventory(archive, sbf_runtime_cache=True), {})
        with self.assertRaisesRegex(ValueError, "symlink escapes"):
            setup.inventory(archive)
        link.unlink()
        link.symlink_to(self.root / "v1.52/platform-tools")
        with self.assertRaisesRegex(ValueError, "Unexpected SBF"):
            setup.inventory(archive, sbf_runtime_cache=True)


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
