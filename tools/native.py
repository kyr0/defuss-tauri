#!/usr/bin/env python3
"""Build and execute real platform-WebView probes twice to check persistent state.

UNKNOWN: each platform/profile stays unverified until this program succeeds there; each success writes
output/native/<os>/<profile>/folder-loopback-lifecycle.json with the binary and Cargo.lock digests.
Each report states its scope; passing loopback probes is not a self-signed TLS claim.
"""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import uuid
from fingerprint import ROOT, source_fingerprint


def run(args: list[str], cwd: Path, env: dict | None = None, timeout: int = 1800) -> None:
    print("RUN:", " ".join(args), flush=True)
    subprocess.run(args, cwd=cwd, env=env, check=True, timeout=timeout)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def native_probe(profile: str) -> int:
    system = {"Linux": "linux", "Darwin": "macos", "Windows": "windows"}.get(platform.system())
    if system is None or not shutil.which("cargo") or not shutil.which("node"):
        raise RuntimeError("Native probe requires a supported desktop OS, Node, Rust, and the Tauri platform prerequisites")
    token = uuid.uuid4().hex
    workspace = ROOT / "tmp/native" / token
    fixture = workspace / "web"
    shutil.copytree(ROOT / "tests/native-fixture", fixture)
    output = ROOT / "output/native" / system / profile
    output.mkdir(parents=True, exist_ok=True)
    identifier = f"dev.defuss.probe{token}"
    command = "build" if profile == "release" else "dev"
    run(["node", str(ROOT / "dist/cli.js"), command, str(fixture), "--identifier", identifier,
         "--managed-dir", str(workspace / "managed"), "--tauri-out", str(workspace / "target"), "--prepare-only"], ROOT)
    native = workspace / "managed" / profile / "src-tauri"
    env = {**os.environ, "CARGO_TARGET_DIR": str(ROOT / "tmp/native-build")}
    run(["cargo", "test", "--manifest-path", str(native / "transport/Cargo.toml")], native, env)
    args = ["cargo", "build", "--features", "custom-protocol,probe"]
    if profile == "release":
        args.append("--release")
    run(args, native, env)
    binary = Path(env["CARGO_TARGET_DIR"]) / ("release" if profile == "release" else "debug") / ("defuss-tauri-host.exe" if system == "windows" else "defuss-tauri-host")
    shutil.copy2(native / "Cargo.lock", output / "Cargo.lock")
    phases = []
    for phase in ("first", "second"):
        destination = output / f"{token}-{phase}.json"
        probe_env = {**env, "DEFUSS_TAURI_PROBE_OUTPUT": str(destination), "DEFUSS_TAURI_PROBE_RUN_ID": f"{token}:{phase}"}
        run([str(binary)], workspace, probe_env, timeout=60)
        report = json.loads(destination.read_text("utf8"))
        if report.get("status") != "VERIFIED" or report.get("runId") != f"{token}:{phase}":
            raise RuntimeError(f"Native capability failure: {report}")
        phases.append(report)
    expected = {"secure_context", "service_worker_api", "worker_activated", "worker_controls_client", "worker_intercepts_fetch", "missing_worker_404", "storage_writes"}
    persisted = {"stable_origin", "local_storage_persists", "cache_storage_persists", "indexeddb_persists"}
    if any(phases[0]["checks"].get(key) is not True for key in expected) or any(phases[1]["checks"].get(key) is not True for key in expected | persisted):
        raise RuntimeError("Native report omitted a required capability check")
    result = {
        "schema": 1, "status": "VERIFIED", "scope": "folder-loopback-lifecycle", "platform": system,
        "profile": profile, "source_fingerprint": source_fingerprint(), "timestamp": datetime.now(timezone.utc).isoformat(),
        "environment": {"os": platform.platform(), "rust": subprocess.check_output(["rustc", "--version"], text=True).strip()},
        "artifact": {"sha256": sha(binary), "bytes": binary.stat().st_size, "cargo_lock_sha256": sha(native / "Cargo.lock")},
        "phases": phases,
        "unverified": ["self-signed TLS", "worker updates after application upgrade", "WSS", "URL native lifecycle", "signed installer", "clean-machine launch without Node"],
    }
    (output / "folder-loopback-lifecycle.json").write_text(json.dumps(result, indent=2) + "\n", "utf8")
    print("VERIFIED[native.folder.loopback]=true; remaining release gates are not waived")
    print(f"PROFILE: {identifier}; test profile is isolated, retained for inspection; no user application storage was cleared")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--profile", choices=["dev", "release"], default="dev")
    args = parser.parse_args()
    try:
        return native_probe(args.profile)
    except (OSError, ValueError, RuntimeError, subprocess.SubprocessError) as error:
        print(f"UNKNOWN[native] / FAILED when a command ran: {error}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
