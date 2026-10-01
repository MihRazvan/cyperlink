#!/usr/bin/env python3
"""Compare a local ELF with an actual loopback validator account, read-only."""
import argparse
import base64
import hashlib
import ipaddress
import json
from pathlib import Path
import socket
import struct
import sys
import urllib.parse
import urllib.request

UPGRADEABLE = "BPFLoaderUpgradeab1e11111111111111111111111"
LOADER_V2 = "BPFLoader2111111111111111111111111111111111"
ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def require(condition, message):
    if not condition:
        raise ValueError(message)


def b58encode(data):
    value = int.from_bytes(data, "big")
    encoded = ""
    while value:
        value, digit = divmod(value, 58)
        encoded = ALPHABET[digit] + encoded
    return "1" * (len(data) - len(data.lstrip(b"\0"))) + encoded


def validate_address(address):
    require(isinstance(address, str) and 32 <= len(address) <= 44, "Invalid program address")
    value = 0
    for character in address:
        require(character in ALPHABET, "Invalid base58 program address")
        value = value * 58 + ALPHABET.index(character)
    size = (value.bit_length() + 7) // 8 + len(address) - len(address.lstrip("1"))
    require(size == 32, "Program address must encode 32 bytes")


def validate_rpc_url(url):
    parsed = urllib.parse.urlsplit(url)
    require(parsed.scheme == "http" and parsed.hostname is not None,
            "RPC must be an HTTP loopback URL")
    require(not parsed.username and not parsed.password and not parsed.query and not parsed.fragment,
            "RPC credentials, query and fragment are forbidden")
    host = parsed.hostname
    if host != "localhost":
        require(ipaddress.ip_address(host).is_loopback, "RPC must use a loopback host")
    addresses = socket.getaddrinfo(host, parsed.port or 80, type=socket.SOCK_STREAM)
    require(addresses and all(ipaddress.ip_address(item[4][0]).is_loopback for item in addresses),
            "RPC resolved outside loopback")
    return url


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("RPC redirects are forbidden")


class Rpc:
    def __init__(self, url):
        self.url = validate_rpc_url(url)
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def __call__(self, method, params):
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode()
        request = urllib.request.Request(self.url, data=body, headers={"Content-Type": "application/json"})
        with self.opener.open(request, timeout=20) as response:
            raw = response.read(16 * 1024 * 1024 + 1)
        require(len(raw) <= 16 * 1024 * 1024, "RPC response too large")
        result = json.loads(raw)
        require("error" not in result, f"RPC {method} failed: {result.get('error')}")
        return result["result"]


def account_bytes(account):
    require(account is not None, "Missing program account")
    require(account["data"][1] == "base64", "Expected base64 RPC account data")
    return base64.b64decode(account["data"][0], validate=True)


def programdata_address(program):
    require(program is not None and program["executable"] is True, "Program must be executable")
    require(program["owner"] in (UPGRADEABLE, LOADER_V2), "Unsupported program loader owner")
    if program["owner"] == LOADER_V2:
        return None
    data = account_bytes(program)
    require(len(data) == 36 and struct.unpack_from("<I", data)[0] == 2,
            "Invalid upgradeable Program state")
    return b58encode(data[4:36])


def compare_program(elf, program, programdata=None):
    require(elf.startswith(b"\x7fELF"), "Local artifact is not an ELF")
    address = programdata_address(program)
    deploy_slot = None
    if address is None:
        require(programdata is None, "Unexpected ProgramData for direct loader")
        loaded = account_bytes(program)
    else:
        require(programdata is not None, "Missing ProgramData account")
        require(programdata["owner"] == UPGRADEABLE and programdata["executable"] is False,
                "Invalid ProgramData owner or executable flag")
        data = account_bytes(programdata)
        require(len(data) >= 45 and struct.unpack_from("<I", data)[0] == 3,
                "Invalid ProgramData state")
        require(data[12] in (0, 1), "Invalid ProgramData upgrade authority option")
        deploy_slot = struct.unpack_from("<Q", data, 4)[0]
        loaded = data[45:]
    require(len(loaded) >= len(elf), "Loaded program is shorter than local ELF")
    require(loaded[:len(elf)] == elf, "Loaded ELF differs from local ELF")
    require(not any(loaded[len(elf):]), "Loaded program has nonzero trailing padding")
    return {"matched": True, "program_owner": program["owner"], "programdata": address,
            "last_deploy_slot": deploy_slot, "elf_bytes": len(elf),
            "elf_sha256": hashlib.sha256(elf).hexdigest(),
            "loaded_elf_sha256": hashlib.sha256(loaded[:len(elf)]).hexdigest(),
            "loaded_account_payload_sha256": hashlib.sha256(loaded).hexdigest(),
            "padding_zero_bytes": len(loaded) - len(elf)}


def verify(rpc, program_id, elf):
    validate_address(program_id)
    options = {"encoding": "base64", "commitment": "confirmed"}
    initial_genesis = rpc("getGenesisHash", [])
    response = rpc("getAccountInfo", [program_id, options])
    program = response["value"]
    address = programdata_address(program)
    programdata = None
    if address is not None:
        # Read both accounts at the same bank; reject a changed deployment pointer.
        response = rpc("getMultipleAccounts", [[program_id, address], options])
        program, programdata = response["value"]
        require(programdata_address(program) == address, "ProgramData pointer changed during read")
    report = compare_program(elf, program, programdata)
    genesis = rpc("getGenesisHash", [])
    require(genesis == initial_genesis, "Validator genesis changed during read")
    report.update(program=program_id, rpc_slot=response["context"]["slot"],
                  genesis_hash=genesis, evidence_level="real-local-validator-account-read",
                  executes_program=False)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--program-id", required=True)
    parser.add_argument("--elf", required=True, type=Path)
    parser.add_argument("--rpc", required=True)
    parser.add_argument("--output", type=Path, help="Create a new evidence JSON file; never overwrite")
    args = parser.parse_args()
    try:
        report = verify(Rpc(args.rpc), args.program_id, args.elf.read_bytes())
        report.update(rpc=args.rpc, local_elf_path=str(args.elf.resolve()))
        output = json.dumps(report, indent=2) + "\n"
        if args.output:
            with args.output.open("x") as stream:
                stream.write(output)
        print(output, end="")
    except (ValueError, OSError, KeyError, TypeError, IndexError) as error:
        print(json.dumps({"matched": False, "error": str(error)}, indent=2), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
