"""Pure account-decoding tests; synthetic bytes do not claim validator execution."""
import base64
import importlib.util
from pathlib import Path
import struct
import unittest

SPEC = importlib.util.spec_from_file_location(
    "loaded", Path(__file__).resolve().parents[1] / "scripts/verify_loaded_program.py")
loaded = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(loaded)
ELF = b"\x7fELFsynthetic-test-bytes"
ADDRESS = loaded.b58encode(bytes([9]) * 32)
PROGRAM = loaded.b58encode(bytes([8]) * 32)


def account(data, owner=loaded.UPGRADEABLE, executable=False):
    return {"owner": owner, "executable": executable,
            "data": [base64.b64encode(data).decode(), "base64"]}


def upgraded(padding=b""):
    program = account(struct.pack("<I", 2) + bytes([9]) * 32, executable=True)
    data = account(struct.pack("<IQB", 3, 42, 1) + bytes([7]) * 32 + ELF + padding)
    return program, data


class LoadedProgramTests(unittest.TestCase):
    def test_upgradeable_exact_match(self):
        result = loaded.compare_program(ELF, *upgraded())
        self.assertTrue(result["matched"])
        self.assertEqual(result["programdata"], ADDRESS)
        self.assertEqual(result["last_deploy_slot"], 42)

    def test_zero_padding_is_explicit(self):
        result = loaded.compare_program(ELF, *upgraded(bytes(11)))
        self.assertEqual(result["padding_zero_bytes"], 11)

    def test_direct_loader(self):
        result = loaded.compare_program(ELF, account(ELF, loaded.LOADER_V2, True))
        self.assertIsNone(result["programdata"])

    def test_nonzero_padding_fails(self):
        with self.assertRaisesRegex(ValueError, "nonzero trailing"):
            loaded.compare_program(ELF, *upgraded(b"\x01"))

    def test_corrupt_loaded_elf_fails(self):
        with self.assertRaisesRegex(ValueError, "differs"):
            loaded.compare_program(ELF[:-1] + b"X", *upgraded())

    def test_truncated_loaded_elf_fails(self):
        with self.assertRaisesRegex(ValueError, "shorter"):
            loaded.compare_program(ELF + b"X", *upgraded())

    def test_wrong_owner_or_nonexecutable_program_fails(self):
        for field, value in [("owner", "unknown"), ("executable", False)]:
            with self.subTest(field=field):
                program, data = upgraded()
                program[field] = value
                with self.assertRaises(ValueError):
                    loaded.compare_program(ELF, program, data)

    def test_wrong_programdata_owner_or_executable_fails(self):
        for field, value in [("owner", loaded.LOADER_V2), ("executable", True)]:
            with self.subTest(field=field):
                program, data = upgraded()
                data[field] = value
                with self.assertRaisesRegex(ValueError, "ProgramData owner"):
                    loaded.compare_program(ELF, program, data)

    def test_wrong_program_and_programdata_state_fails(self):
        program, data = upgraded()
        bad_program = account(struct.pack("<I", 1) + bytes([9]) * 32, executable=True)
        with self.assertRaisesRegex(ValueError, "Program state"):
            loaded.compare_program(ELF, bad_program, data)
        bad_data = account(struct.pack("<IQB", 2, 42, 1) + bytes(32) + ELF)
        with self.assertRaisesRegex(ValueError, "ProgramData state"):
            loaded.compare_program(ELF, program, bad_data)

    def test_missing_programdata_fails(self):
        program, _ = upgraded()
        with self.assertRaisesRegex(ValueError, "Missing ProgramData"):
            loaded.compare_program(ELF, program)

    def test_bad_authority_tag_fails(self):
        program, _ = upgraded()
        data = account(struct.pack("<IQB", 3, 42, 2) + bytes(32) + ELF)
        with self.assertRaisesRegex(ValueError, "authority option"):
            loaded.compare_program(ELF, program, data)

    def test_remote_or_credential_rpc_rejected(self):
        for url in ["https://127.0.0.1:8899", "http://192.0.2.1:8899",
                    "http://example.com:8899", "http://a:b@127.0.0.1:8899"]:
            with self.subTest(url=url), self.assertRaises(ValueError):
                loaded.validate_rpc_url(url)

    def test_loopback_rpc_allowed(self):
        self.assertEqual(loaded.validate_rpc_url("http://127.0.0.1:8899"), "http://127.0.0.1:8899")

    def test_program_address_has_exact_length(self):
        loaded.validate_address(PROGRAM)
        with self.assertRaises(ValueError):
            loaded.validate_address("1" * 33)

    def test_rpc_flow_records_actual_context_and_genesis(self):
        program, data = upgraded()
        calls = []
        def rpc(method, params):
            calls.append(method)
            if method == "getGenesisHash":
                return "synthetic-genesis"
            if method == "getAccountInfo":
                return {"context": {"slot": 11}, "value": program}
            self.assertEqual(params[0], [PROGRAM, ADDRESS])
            return {"context": {"slot": 12}, "value": [program, data]}
        result = loaded.verify(rpc, PROGRAM, ELF)
        self.assertEqual(result["rpc_slot"], 12)
        self.assertEqual(result["genesis_hash"], "synthetic-genesis")
        self.assertFalse(result["executes_program"])
        self.assertEqual(calls.count("getGenesisHash"), 2)

    def test_changed_programdata_pointer_is_rejected(self):
        program, data = upgraded()
        def rpc(method, params):
            if method == "getGenesisHash":
                return "genesis"
            if method == "getAccountInfo":
                return {"context": {"slot": 11}, "value": program}
            changed = account(struct.pack("<I", 2) + bytes([6]) * 32, executable=True)
            return {"context": {"slot": 12}, "value": [changed, data]}
        with self.assertRaisesRegex(ValueError, "pointer changed"):
            loaded.verify(rpc, PROGRAM, ELF)


if __name__ == "__main__":
    unittest.main()
