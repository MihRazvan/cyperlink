#!/usr/bin/env python3
"""Install only the pinned, research-qualified local tools; no signing or transactions."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import platform
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import urllib.request

from verify_loaded_program import NoRedirect, account_bytes, compare_program, programdata_address, require

ROOT = Path(__file__).resolve().parents[1]
LOCAL = ROOT / ".local/toolchain"
NATIVE = LOCAL / "native"
SBF_DEPENDENCIES = "solana-release/bin/platform-tools-sdk/sbf/dependencies"
SBF_CACHE_LINK = f"{SBF_DEPENDENCIES}/platform-tools"
SBF_CACHE_LINKS = {
    SBF_CACHE_LINK: "v1.57/platform-tools",
    f"{SBF_DEPENDENCIES}/criterion": "v2.3.2/criterion",
}
# The pinned Darwin install.sh creates these empty completion markers. Its
# default v1.52 marker does not qualify a compiler or permit a v1.52 cache link.
SBF_CACHE_MARKERS = {
    f"{SBF_DEPENDENCIES}/criterion-v2.3.2.md",
    f"{SBF_DEPENDENCIES}/platform-tools-v1.52.md",
}


def sha(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def inside(base, relative):
    path = PurePosixPath(relative)
    require(not path.is_absolute() and ".." not in path.parts and path.parts, "Unsafe relative path")
    result = base.joinpath(*path.parts)
    require(base.resolve() in result.resolve().parents, "Path escapes installation directory")
    return result


def inventory(directory, sbf_runtime_cache=False):
    result = {}
    for p in sorted(directory.rglob("*")):
        name = p.relative_to(directory).as_posix()
        if sbf_runtime_cache and name in SBF_CACHE_LINKS:
            # These exact links are generated after installation, not archived
            # release files. Do not accept same-suffix paths or redirected caches.
            expected = Path.home() / ".cache/solana" / SBF_CACHE_LINKS[name]
            require(p.is_symlink() and os.readlink(p) == str(expected)
                    and expected.resolve() == expected and p.is_dir(),
                    "Unexpected SBF runtime cache link")
            continue
        if sbf_runtime_cache and name in SBF_CACHE_MARKERS:
            metadata = p.lstat()
            require(stat.S_ISREG(metadata.st_mode) and metadata.st_size == 0,
                    "Unexpected SBF runtime cache marker")
            continue
        if p.is_symlink():
            require(directory.resolve() in p.resolve().parents, "Installed symlink escapes directory")
            result[name] = {"symlink": os.readlink(p)}
        elif p.is_file():
            result[name] = {"sha256": sha(p), "bytes": p.stat().st_size, "mode": p.stat().st_mode & 0o777}
    return result


def extract(archive, destination):
    """Extract validated regular files first, then internal links; never follow tar links."""
    destination.mkdir(exist_ok=False)
    with tarfile.open(archive, "r:*") as tar:
        members = tar.getmembers()
        paths = {}
        for member in members:
            name = member.name.removeprefix("./").rstrip("/")
            if not name and member.isdir():
                continue
            target = inside(destination, name)
            require(name not in paths, "Duplicate archive member")
            require(member.isfile() or member.isdir() or member.issym() or member.islnk(), "Special archive member forbidden")
            paths[name] = (member, target)
        link_names = {name for name, (m, _) in paths.items() if m.issym() or m.islnk()}
        for name in paths:
            require(not any(str(p) in link_names for p in PurePosixPath(name).parents), "Archive member beneath link")
        for name, (member, target) in paths.items():
            if member.isdir():
                target.mkdir(parents=True, exist_ok=True)
            elif member.isfile():
                target.parent.mkdir(parents=True, exist_ok=True)
                with tar.extractfile(member) as source, target.open("xb") as out:
                    shutil.copyfileobj(source, out)
                target.chmod(member.mode & 0o755)
        for name, (member, target) in paths.items():
            if not (member.issym() or member.islnk()):
                continue
            require(not PurePosixPath(member.linkname).is_absolute(), "Absolute archive link forbidden")
            linked = (target.parent / member.linkname) if member.issym() else destination / member.linkname
            require(destination.resolve() in linked.resolve().parents, "Archive link escapes destination")
            require(linked.is_file() or linked.is_dir(), "Archive link target missing")
            target.parent.mkdir(parents=True, exist_ok=True)
            if member.issym():
                target.symlink_to(member.linkname)
            else:
                os.link(linked, target)


def download(asset, cache):
    cache.mkdir(parents=True, exist_ok=True)
    target = cache / asset["sha256"]
    if target.exists():
        require(not target.is_symlink() and sha(target) == asset["sha256"], "Cached asset hash mismatch")
        return target
    require(asset["url"].startswith("https://"), "Asset must use HTTPS")
    fd, name = tempfile.mkstemp(prefix="download-", dir=cache)
    temporary = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream, urllib.request.urlopen(asset["url"], timeout=120) as response:
            require(response.url.startswith("https://"), "Download redirected outside HTTPS")
            shutil.copyfileobj(response, stream, 1024 * 1024)
        require(sha(temporary) == asset["sha256"], f"Downloaded asset hash mismatch: {asset['name']}")
        os.link(temporary, target)
        return target
    finally:
        temporary.unlink(missing_ok=True)


def install_asset(asset, native, cache, verify_only=False):
    receipt = inside(native, f"receipts/{asset['name']}.json")
    target = inside(native, asset.get("directory", asset.get("path")))
    if receipt.exists():
        record = json.loads(receipt.read_text())
        require(record["asset_sha256"] == asset["sha256"], "Installed asset pin changed")
        observed = inventory(target, asset["name"] == "sbf-launcher") if asset["format"].startswith("tar") else {"sha256": sha(target)}
        require(record["installed"] == observed, f"Installed asset changed: {asset['name']}")
        if asset["format"] == "file":
            require(observed["sha256"] == asset["sha256"], "Installed raw asset differs from pinned hash")
        return record
    require(not verify_only, f"Asset not installed: {asset['name']}")
    require(not target.exists() and not target.is_symlink(), f"Unverified installation already exists: {target}")
    archive = download(asset, cache)
    target.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(tempfile.mkdtemp(prefix="install-", dir=native))
    try:
        ready = stage / "ready"
        if asset["format"].startswith("tar"):
            extract(archive, ready)
            observed = inventory(ready)
        else:
            shutil.copyfile(archive, ready)
            ready.chmod(0o755 if asset.get("executable") else 0o644)
            observed = {"sha256": sha(ready)}
        ready.rename(target)
        record = {"name": asset["name"], "asset_sha256": asset["sha256"], "path": str(target), "installed": observed}
        receipt.parent.mkdir(exist_ok=True)
        with receipt.open("x") as stream:
            json.dump(record, stream, indent=2)
        return record
    finally:
        shutil.rmtree(stage)


class PublicArtifactRpc:
    """Separate fixed public read client; the loopback ELF verifier stays unchanged."""
    def __init__(self, url):
        require(url == "https://api.mainnet-beta.solana.com", "Unexpected artifact RPC endpoint")
        self.url = url
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())

    def __call__(self, method, params):
        require(method in {"getGenesisHash", "getAccountInfo", "getMultipleAccounts"}, "Public RPC method forbidden")
        request = urllib.request.Request(self.url, data=json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode(), headers={"Content-Type": "application/json"})
        with self.opener.open(request, timeout=60) as response:
            raw = response.read(16 * 1024 * 1024 + 1)
        require(len(raw) <= 16 * 1024 * 1024, "Artifact RPC response too large")
        result = json.loads(raw)
        require("error" not in result, f"Artifact RPC error: {result.get('error')}")
        return result["result"]


def fetch_program(rpc, spec, genesis):
    require(rpc("getGenesisHash", []) == genesis, "Wrong artifact network genesis")
    options = {"encoding": "base64", "commitment": "finalized"}
    response = rpc("getAccountInfo", [spec["address"], options])
    program = response["value"]
    pointer = programdata_address(program)
    data_account = None
    if pointer:
        response = rpc("getMultipleAccounts", [[spec["address"], pointer], options])
        program, data_account = response["value"]
        require(programdata_address(program) == pointer, "ProgramData pointer changed during read")
    payload = account_bytes(data_account)[45:] if pointer else account_bytes(program)
    # Pinned artifact length includes the complete recorded loaded payload.
    require(len(payload) == spec["bytes"], "Public program length drift")
    require(hashlib.sha256(payload).hexdigest() == spec["sha256"], "Public program hash drift")
    report = compare_program(payload, program, data_account)
    require(rpc("getGenesisHash", []) == genesis, "Artifact network changed")
    report.update(program=spec["address"], rpc_slot=response["context"]["slot"], genesis_hash=genesis,
                  evidence_kind="read-only public program artifact retrieval; no execution or transactions")
    return payload, report


def install_program(spec, config, verify_only):
    target = inside(NATIVE, spec["path"])
    receipt = inside(NATIVE, f"receipts/{spec['name']}.json")
    if target.exists():
        require(not target.is_symlink() and receipt.is_file(), "Unverified existing public program")
        require(target.stat().st_size == spec["bytes"] and sha(target) == spec["sha256"], "Installed public program mismatch")
        record = json.loads(receipt.read_text())
        require(record["program"] == spec["address"] and record["genesis_hash"] == config["artifact_genesis"]
                and record["elf_sha256"] == spec["sha256"] and record["elf_bytes"] == spec["bytes"],
                "Public artifact receipt does not match pinned identity")
        return record
    require(not verify_only, f"Public program not installed: {spec['name']}")
    payload, record = fetch_program(PublicArtifactRpc(config["artifact_rpc"]), spec, config["artifact_genesis"])
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("xb") as stream:
        stream.write(payload)
    record["path"] = str(target)
    with receipt.open("x") as stream:
        json.dump(record, stream, indent=2)
    return record


def docker_status(images, pull):
    results = {}
    for name in sorted(set(images.values())):
        command = ["docker", "image", "inspect", name, "--format", "{{json .RepoDigests}}"]
        try:
            result = subprocess.run(command, capture_output=True, text=True)
            if result.returncode and pull:
                subprocess.run(["docker", "pull", name], check=True)
                result = subprocess.run(command, capture_output=True, text=True)
            results[name] = {"cached_verified": result.returncode == 0 and name in json.loads(result.stdout or "[]")}
        except (OSError, ValueError):
            results[name] = {"cached_verified": False}
        if pull:
            require(results[name]["cached_verified"], f"Docker image not verified: {name}")
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verify-only", action="store_true")
    parser.add_argument("--pull-images", action="store_true", help="explicitly allow pulling digest-pinned Docker images")
    args = parser.parse_args()
    require(not (args.verify_only and args.pull_images), "--verify-only cannot pull images")
    config_path = ROOT / "config/local-toolchain.json"
    config = json.loads(config_path.read_text())
    require(platform.system() == config["platform"]["system"] and platform.machine() == config["platform"]["machine"], "Only the qualified Darwin arm64 host is supported")
    for directory in (ROOT / ".local", LOCAL, NATIVE, LOCAL / "downloads", NATIVE / "receipts"):
        require(not directory.is_symlink(), f"Toolchain directory must not be a symlink: {directory}")
    if not args.verify_only:
        NATIVE.mkdir(parents=True, exist_ok=True)
    for asset in config["assets"]:
        print(f"Verifying/installing {asset['name']}", file=sys.stderr, flush=True)
        install_asset(asset, NATIVE, LOCAL / "downloads", args.verify_only)
    programs = {s["name"]: install_program(s, config, args.verify_only) for s in config["public_programs"]}
    for asset in config["assets"]:
        if asset["name"] in {"arcium-program", "arcium-staking"}:
            programs[asset["name"]] = {"path": str(inside(NATIVE, asset["path"])), "sha256": asset["sha256"]}
    executables = {}
    for name, spec in config["executables"].items():
        path = inside(NATIVE, spec["path"])
        digest = sha(path)
        require("sha256" not in spec or digest == spec["sha256"], f"Executable hash mismatch: {name}")
        version = subprocess.check_output([str(path), "--version"], text=True, stderr=subprocess.STDOUT)
        require(version.startswith(spec["version_prefix"]), f"Executable version mismatch: {name}: {version!r}")
        executables[name] = {"path": str(path), "sha256": digest, "version": version.strip()}
    report = {"schema_version": 1, "manifest_sha256": sha(config_path), "platform": config["platform"], "executables": executables,
              "programs": programs, "docker_images": docker_status(config["docker_images"], args.pull_images),
              "prerequisites": {"host_rust_required": config["host_rust"], "sbf_tools_required": config["sbf_tools"], "globally_installed_by_this_script": False},
              "public_transactions": False, "private_keys_accessed": False, "verified": True}
    sbf_cache = NATIVE / "agave-3.1.14" / SBF_CACHE_LINK
    report["prerequisites"]["sbf_runtime_cache_link"] = str(sbf_cache.resolve()) if sbf_cache.is_symlink() else None
    report["prerequisites"]["sbf_runtime_cache_links"] = {
        name: str((NATIVE / "agave-3.1.14" / name).resolve())
        for name in SBF_CACHE_LINKS if (NATIVE / "agave-3.1.14" / name).is_symlink()
    }
    report["prerequisites"]["sbf_runtime_cache_qualified_by_this_script"] = False
    if not args.verify_only:
        report_path = NATIVE / "installation.json"
        temporary = NATIVE / "installation.json.tmp"
        with temporary.open("x") as stream:
            json.dump(report, stream, indent=2)
        temporary.replace(report_path)
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f"toolchain setup failed: {error}", file=sys.stderr)
        sys.exit(1)
