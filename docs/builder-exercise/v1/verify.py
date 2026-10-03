#!/usr/bin/env python3
"""Read-only exercise freeze check. No install, build, RPC or key access."""
import hashlib
import json
from pathlib import Path
import subprocess

PACKAGE = Path(__file__).resolve().parent
ROOT = PACKAGE.parents[2]


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode()


def verify(manifest):
    payload = {key: value for key, value in manifest.items() if key != "packageId"}
    assert hashlib.sha256(canonical(payload)).hexdigest() == manifest["packageId"], "Manifest identity differs"
    baseline = manifest["baselineCommit"]
    assert subprocess.check_output(["git", "rev-parse", f"{baseline}^{{commit}}"], cwd=ROOT, text=True).strip() == baseline
    tracked = set(subprocess.check_output(["git", "ls-files", "--", *manifest["protectedRoots"]], cwd=ROOT, text=True).splitlines())
    expected_tracked = {name for name in manifest["baselineFiles"] if name.split("/")[0] in manifest["protectedRoots"]}
    assert tracked == expected_tracked, "Tracked tooling file set changed"
    for group in ["packageFiles", "baselineFiles"]:
        for name, expected in manifest[group].items():
            path = ROOT / name
            assert not path.is_symlink() and path.resolve().is_relative_to(ROOT), f"Unsafe path: {name}"
            assert hashlib.sha256(path.read_bytes()).hexdigest() == expected, f"Changed frozen file: {name}"
            if group == "baselineFiles":
                historical = subprocess.check_output(["git", "show", f"{baseline}:{name}"], cwd=ROOT)
                assert hashlib.sha256(historical).hexdigest() == expected, f"Not baseline bytes: {name}"
    actual = {str(p.relative_to(ROOT)) for p in PACKAGE.rglob("*") if p.is_file() and p.name != "freeze.json" and "__pycache__" not in p.parts}
    assert actual == set(manifest["packageFiles"]), "Exercise package file set changed"
    return {"verified": True, "packageId": manifest["packageId"], "baselineCommit": baseline,
            "packageFiles": len(manifest["packageFiles"]), "baselineFiles": len(manifest["baselineFiles"]),
            "runtimeReadiness": "not-tested", "builderExercise": "not-run"}


if __name__ == "__main__":
    print(json.dumps(verify(json.loads((PACKAGE / "freeze.json").read_text())), indent=2))
