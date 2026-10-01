#!/usr/bin/env python3
"""Build both real runtime circuits in a fresh local staging directory and compare bytes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]


def digest(path):
    data = path.read_bytes()
    return {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}


def check_artifacts(directory, baseline):
    """Check every required artifact and its native hash-file relationship."""
    results = {}
    for name, expected in baseline["artifacts"].items():
        actual = digest(directory / name)
        if actual != expected:
            raise ValueError(f"artifact mismatch: {name}: expected {expected}, got {actual}")
        results[name] = actual
    for name in ("runtime_budget_init", "runtime_budget_bound"):
        values = json.loads((directory / f"{name}.hash").read_text())
        if not isinstance(values, list) or len(values) != 32 or any(type(v) is not int or not 0 <= v <= 255 for v in values):
            raise ValueError(f"invalid native hash file: {name}")
        if bytes(values).hex() != results[f"{name}.arcis"]["sha256"]:
            raise ValueError(f"native hash does not authenticate arcis bytes: {name}")
    return results


def stage(source, output):
    """Copy only source and locked dependencies, never prebuilt artifacts or cache markers."""
    output.mkdir(parents=True, exist_ok=False)
    compiler = output / "compiler"
    compiler.mkdir()
    for name in ("Cargo.toml", "Cargo.lock"):
        shutil.copy2(source / name, compiler / name)
    shutil.copytree(source / "src", compiler / "src")
    return compiler


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", required=True, type=Path, help="fresh directory inside this repository's .local")
    parser.add_argument("--allow-network", action="store_true", help="allow Cargo to download versions already pinned by Cargo.lock")
    args = parser.parse_args()
    output = args.out.resolve()
    local = (ROOT / ".local").resolve()
    if local not in output.parents:
        parser.error("--out must be a fresh directory below repository .local")
    source = ROOT / "circuits/budget"
    baseline = json.loads((source / "baseline.json").read_text())
    # Fail before compiling if the checked-in deployed artifacts were changed.
    reviewed = check_artifacts(ROOT / "programs/auth/build", baseline)
    compiler = stage(source, output)
    sources = {str(p.relative_to(compiler)): digest(p) for p in sorted(compiler.rglob("*")) if p.is_file()}
    command = ["cargo", "run", "--locked", "--manifest-path", str(compiler / "Cargo.toml")]
    if not args.allow_network:
        command.append("--offline")
    env = dict(os.environ, CARGO_TARGET_DIR=str(local / "circuit-build-target"))
    report = {
        "schema": 1, "evidence_kind": "fresh host circuit compilation and exact artifact byte comparison",
        "distributed_execution": False, "public_network": False,
        "compiler_version": baseline["compiler_version"], "command": command,
        "toolchain": {name: subprocess.check_output([name, "--version"], text=True).strip() for name in ("rustc", "cargo")},
        "sources": sources, "baseline_manifest": digest(source / "baseline.json"),
        "reviewed_artifacts": reviewed, "passed": False,
    }
    started = time.monotonic()
    try:
        with (output / "compile.log").open("w") as log:
            subprocess.run(command, cwd=compiler, env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        if digest(compiler / "Cargo.lock") != sources["Cargo.lock"]:
            raise ValueError("locked dependency file changed during compilation")
        report["rebuilt_artifacts"] = check_artifacts(compiler / "build", baseline)
        for name in reviewed:
            if (compiler / "build" / name).read_bytes() != (ROOT / "programs/auth/build" / name).read_bytes():
                raise ValueError(f"byte comparison failed: {name}")
        report["passed"] = True
    except Exception as error:
        report["error"] = str(error)
        raise
    finally:
        report["host_build_elapsed_seconds"] = round(time.monotonic() - started, 3)
        (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({"passed": True, "artifact_count": len(reviewed), "report": str(output / "report.json")}))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f"circuit rebuild failed: {error}", file=sys.stderr)
        sys.exit(1)
