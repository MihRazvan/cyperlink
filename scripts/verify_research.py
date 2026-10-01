#!/usr/bin/env python3
"""Read-only verification of pinned, archived research. Never runs a validator."""

import argparse
import hashlib
import json
import os
from pathlib import Path
import sys

DEFAULT_BASELINE = Path(__file__).resolve().parents[1] / "config/research-baseline.json"


class VerificationError(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise VerificationError(message)


def artifact(root, relative):
    require(isinstance(relative, str), "Artifact path must be a string")
    path = Path(relative)
    require(not path.is_absolute() and ".." not in path.parts,
            f"Unsafe artifact path: {relative}")
    resolved = (root / path).resolve()
    require(resolved.is_relative_to(root), f"Artifact escapes research root: {relative}")
    require(resolved.is_file(), f"Missing artifact: {relative}")
    return resolved


def verify(root, baseline):
    """Raise VerificationError on failure; return a JSON-serializable report."""
    root = Path(root).resolve()
    require(baseline.get("schema_version") == 1, "Unsupported baseline schema")
    entries = baseline["files"]
    pinned = {entry["path"]: entry for entry in entries}
    require(len(pinned) == len(entries), "Duplicate artifact paths in baseline")
    require(bool(entries), "Empty baseline")
    checked_bytes = 0
    for entry in entries:
        data = artifact(root, entry["path"]).read_bytes()
        require(len(data) == entry["bytes"], f"Size mismatch: {entry['path']}")
        require(hashlib.sha256(data).hexdigest() == entry["sha256"],
                f"SHA256 mismatch: {entry['path']}")
        checked_bytes += len(data)

    roles = baseline["roles"]
    for path in roles.values():
        require(path in pinned, f"Unpinned evidence role: {path}")

    def read(role):
        return json.loads(artifact(root, roles[role]).read_text())

    provenance = read("provenance")
    require(provenance["public_network_mutations"] is False,
            "Baseline must not claim public-network writes")
    require(bool(provenance["files"]), "Empty original provenance")
    for entry in provenance["files"]:
        require(pinned.get(entry["path"]) == entry,
                f"Original provenance differs from pin: {entry['path']}")

    results = read("results")
    require(results["passed"] is True, "Archived joined probe did not pass")
    require(read("extra_checks")["passed"] is True, "Archived extra checks did not pass")
    require(results["finalQuota"]["version"] == "1", "Unexpected final quota version")
    require(results["finalQuota"]["counter"] == "6", "Unexpected final quota counter")
    privacy = results["privacyChecks"]
    require(len(privacy) == 3 and {item["label"] for item in privacy} == {
        "wrong low amount", "wrong high amount", "wrong opening"
    }, "Missing or duplicate privacy boundary checks")

    rpc = read("rpc_crosscheck")

    def check_receipt(receipt, signature, label):
        require(receipt is not None, f"Missing recorded RPC transaction: {label}")
        require(receipt["meta"]["err"] is None, f"Recorded transaction failed: {label}")
        require(signature in receipt["transaction"]["signatures"],
                f"Recorded signature mismatch: {label}")

    for item in privacy:
        label = item["label"]
        require(item["output"]["field1"] is False, f"Private input mismatch allowed: {label}")
        check_receipt(item["transaction"], item["signature"], label)
        check_receipt(rpc[label + " callback"], item["signature"], label)

    proofs = read("native_proofs")
    require(set(proofs) == {"a", "b"}, "Expected two native proof groups")
    for group, items in proofs.items():
        require(len(items) == 3, f"Expected three native proofs: {group}")
        for index, item in enumerate(items):
            require(item["signature_verified"] is True, "Native owner signature not verified")
            label = f"native proof {group}/{index} {item['signature'][:8]}"
            check_receipt(rpc[label], item["signature"], label)

    settlement = results["nativeSettlement"]
    require(settlement["signature_verified"] is True, "Settlement owner signature not verified")
    check_receipt(rpc["native A success " + settlement["signature"][:8]],
                  settlement["signature"], "native settlement")

    # This validates the saved review record against the pinned local bytes.
    # It is deliberately NOT a fresh fetch of ProgramData from an active node.
    elf = read("elf_match")
    require(elf["matched"] is True, "Recorded loaded ELF did not match")
    require(elf["source_contains_grouped_proof_type_check"] is True,
            "Recorded source predates the final grouped proof-type check")
    require(elf["local_elf_path"] == roles["auth_elf"], "Wrong recorded ELF path")
    require(elf["elf_sha256"] == pinned[roles["auth_elf"]]["sha256"],
            "Recorded loaded ELF hash mismatch")
    require(elf["elf_bytes"] == pinned[roles["auth_elf"]]["bytes"],
            "Recorded loaded ELF size mismatch")
    require(elf["source_sha256"] == pinned[roles["auth_source"]]["sha256"],
            "Recorded source hash mismatch")
    return {
        "passed": True,
        "verification": "archived-baseline-only",
        "fresh_execution": False,
        "fresh_loaded_elf_check": False,
        "checked_files": len(entries),
        "checked_bytes": checked_bytes,
        "native_proof_receipts": 6,
        "denied_private_input_callbacks": 3,
        "auth_elf_sha256": elf["elf_sha256"],
        "runtime_circuit_sha256": pinned[roles["runtime_circuit"]]["sha256"],
        "remaining_gap": "Full pre-disclosure native admission and authorized-query semantics",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--research-root", default=os.environ.get("CYPERLINK_RESEARCH_ROOT"),
                        help="Original research root or handoff research-snapshot directory")
    args = parser.parse_args()
    if not args.research_root:
        parser.error("Set --research-root or CYPERLINK_RESEARCH_ROOT")
    try:
        baseline = json.loads(DEFAULT_BASELINE.read_text())
        report = verify(args.research_root, baseline)
    except (VerificationError, OSError, ValueError, KeyError, TypeError) as error:
        print(json.dumps({"passed": False, "verification": "archived-baseline-only",
                          "error": str(error)}, indent=2), file=sys.stderr)
        return 1
    print(json.dumps(report, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
