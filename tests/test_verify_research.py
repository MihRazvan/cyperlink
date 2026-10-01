"""Verifier tests use small synthetic archive records, never native fixtures."""

import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location(
    "verify_research", Path(__file__).resolve().parents[1] / "scripts/verify_research.py")
verifier = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(verifier)


def receipt(signature):
    return {"meta": {"err": None}, "transaction": {"signatures": [signature]}}


class VerifyResearchTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.roles = {name: name + ".json" for name in (
            "provenance", "results", "extra_checks", "native_proofs",
            "rpc_crosscheck", "elf_match", "auth_elf", "auth_source", "runtime_circuit")}
        for name in ("auth_elf", "auth_source", "runtime_circuit"):
            (self.root / self.roles[name]).write_bytes(("synthetic " + name).encode())
        privacy = [{"label": label, "signature": label,
                    "output": {"field1": False}, "transaction": receipt(label)}
                   for label in ("wrong low amount", "wrong high amount", "wrong opening")]
        proofs = {group: [{"signature": f"proof-{group}{index}", "signature_verified": True}
                          for index in range(3)] for group in ("a", "b")}
        rpc = {item["label"] + " callback": receipt(item["signature"]) for item in privacy}
        for group, items in proofs.items():
            for index, item in enumerate(items):
                rpc[f"native proof {group}/{index} {item['signature'][:8]}"] = receipt(item["signature"])
        rpc["native A success settle"] = receipt("settle")
        elf_pin = self.pin("auth_elf")
        self.write("elf_match", {
            "matched": True, "source_contains_grouped_proof_type_check": True,
            "local_elf_path": self.roles["auth_elf"], "elf_sha256": elf_pin["sha256"],
            "elf_bytes": elf_pin["bytes"], "source_sha256": self.pin("auth_source")["sha256"],
        })
        self.write("results", {
            "passed": True, "finalQuota": {"version": "1", "counter": "6"},
            "privacyChecks": privacy,
            "nativeSettlement": {"signature": "settle", "signature_verified": True},
        })
        self.write("extra_checks", {"passed": True})
        self.write("native_proofs", proofs)
        self.write("rpc_crosscheck", rpc)
        self.write("provenance", {
            "public_network_mutations": False,
            "files": [self.pin(name) for name in ("auth_elf", "auth_source", "runtime_circuit")],
        })
        self.baseline = {"schema_version": 1, "roles": self.roles,
                         "files": [self.pin(name) for name in self.roles]}

    def pin(self, role):
        data = (self.root / self.roles[role]).read_bytes()
        return {"path": self.roles[role], "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest()}

    def write(self, role, value):
        (self.root / self.roles[role]).write_text(json.dumps(value))

    def alter_record(self, role, change):
        """Repin altered record to exercise semantics beyond byte corruption."""
        value = json.loads((self.root / self.roles[role]).read_text())
        change(value)
        self.write(role, value)
        self.baseline["files"] = [self.pin(role) if x["path"] == self.roles[role] else x
                                  for x in self.baseline["files"]]

    def verify(self):
        return verifier.verify(self.root, self.baseline)

    def test_valid_archive_is_explicitly_not_a_fresh_run(self):
        result = self.verify()
        self.assertTrue(result["passed"])
        self.assertFalse(result["fresh_execution"])
        self.assertFalse(result["fresh_loaded_elf_check"])

    def test_same_size_corruption_fails_hash(self):
        path = self.root / self.roles["runtime_circuit"]
        data = path.read_bytes()
        path.write_bytes(bytes([data[0] ^ 1]) + data[1:])
        with self.assertRaisesRegex(verifier.VerificationError, "SHA256 mismatch"):
            self.verify()

    def test_missing_evidence_fails(self):
        (self.root / self.roles["rpc_crosscheck"]).unlink()
        with self.assertRaisesRegex(verifier.VerificationError, "Missing artifact"):
            self.verify()

    def test_failed_extra_checks_cannot_hide_behind_valid_hash(self):
        self.alter_record("extra_checks", lambda x: x.update(passed=False))
        with self.assertRaisesRegex(verifier.VerificationError, "extra checks did not pass"):
            self.verify()

    def test_wrong_final_quota_fails(self):
        self.alter_record("results", lambda x: x["finalQuota"].update(version="0"))
        with self.assertRaisesRegex(verifier.VerificationError, "quota version"):
            self.verify()

    def test_privacy_callback_must_be_denied(self):
        self.alter_record("results", lambda x: x["privacyChecks"][0]["output"].update(field1=True))
        with self.assertRaisesRegex(verifier.VerificationError, "mismatch allowed"):
            self.verify()

    def test_recorded_failed_transaction_is_not_success(self):
        self.alter_record("rpc_crosscheck", lambda x: x["wrong opening callback"]["meta"].update(err="failed"))
        with self.assertRaisesRegex(verifier.VerificationError, "transaction failed"):
            self.verify()

    def test_wrong_callback_signature_fails(self):
        self.alter_record("rpc_crosscheck", lambda x: x["wrong opening callback"]["transaction"].update(signatures=["other"]))
        with self.assertRaisesRegex(verifier.VerificationError, "signature mismatch"):
            self.verify()

    def test_recorded_loaded_elf_must_match_pinned_bytes(self):
        self.alter_record("elf_match", lambda x: x.update(elf_sha256="0" * 64))
        with self.assertRaisesRegex(verifier.VerificationError, "loaded ELF hash mismatch"):
            self.verify()

    def test_source_review_must_match_pinned_source(self):
        self.alter_record("elf_match", lambda x: x.update(source_sha256="0" * 64))
        with self.assertRaisesRegex(verifier.VerificationError, "source hash mismatch"):
            self.verify()

    def test_manifest_itself_cannot_drift(self):
        self.alter_record("provenance", lambda x: x["files"][0].update(sha256="0" * 64))
        with self.assertRaisesRegex(verifier.VerificationError, "provenance differs"):
            self.verify()

    def test_path_escape_is_rejected(self):
        self.baseline["files"][0]["path"] = "../outside"
        with self.assertRaisesRegex(verifier.VerificationError, "Unsafe artifact path"):
            self.verify()

    def test_symlink_escape_is_rejected(self):
        with tempfile.TemporaryDirectory() as external:
            outside = Path(external) / "outside"
            path = self.root / self.roles["auth_elf"]
            outside.write_bytes(path.read_bytes())
            path.unlink()
            path.symlink_to(outside)
            with self.assertRaisesRegex(verifier.VerificationError, "escapes research root"):
                self.verify()

    def test_evidence_role_cannot_be_unpinned(self):
        self.baseline["roles"] = copy.copy(self.roles)
        self.baseline["roles"]["results"] = "untrusted.json"
        with self.assertRaisesRegex(verifier.VerificationError, "Unpinned evidence role"):
            self.verify()


if __name__ == "__main__":
    unittest.main()
