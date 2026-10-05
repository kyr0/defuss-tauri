#!/usr/bin/env python3
"""Exercise the actual npm package payload in isolation, not source-tree imports."""
from __future__ import annotations
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
from fingerprint import ROOT


def main() -> int:
    npm = shutil.which("npm")
    node = shutil.which("node")
    if not npm or not node:
        raise RuntimeError("Packaging e2e requires Node and npm (build-machine tools only)")
    with tempfile.TemporaryDirectory(prefix="defuss-pack-e2e-") as temporary:
        root = Path(temporary)
        packed = subprocess.run([npm, "pack", "--ignore-scripts", "--json", "--pack-destination", str(root)], cwd=ROOT, check=True, capture_output=True, text=True, timeout=90)
        metadata = json.loads(packed.stdout)[0]
        archive = root / metadata["filename"]
        with tarfile.open(archive) as stream:
            names = []
            for item in stream.getmembers():
                path = Path(item.name)
                if path.is_absolute() or ".." in path.parts or item.issym() or item.islnk():
                    raise RuntimeError("Package contains an unsafe archive entry")
                names.append(item.name)
                if item.isfile():
                    destination = root / "unpacked" / path
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    source = stream.extractfile(item)
                    if source is None:
                        raise RuntimeError("Missing archive file data")
                    destination.write_bytes(source.read())
        if any("node_modules" in Path(name).parts or "vendor" in Path(name).parts for name in names):
            raise RuntimeError("Development dependencies leaked into the package")
        if any("target" in Path(name).parts or Path(name).name == "Cargo.lock" for name in names):
            raise RuntimeError("Cargo build output or an unpinned lock leaked into the package")
        package = root / "unpacked/package"
        for expected in ("dist/cli.js", "dist/index.d.ts", "rust_templates/src/main.rs", "rust_templates/transport/src/lib.rs", "defuss-tauri.schema.json", "LICENSE"):
            if not (package / expected).is_file():
                raise RuntimeError(f"Publishable package missing {expected}")
        workspace = root / "consumer"; workspace.mkdir()
        subprocess.run([node, str(package / "dist/cli.js"), "--help"], cwd=workspace, check=True, capture_output=True, timeout=30)
        subprocess.run([node, str(package / "dist/cli.js"), "build", "http://127.0.0.1:1", "--prepare-only"], cwd=workspace, check=True, capture_output=True, timeout=30)
        runtime = json.loads((workspace / ".defuss-tauri/release/src-tauri/runtime.json").read_text())
        if runtime["target"]["url"] != "http://127.0.0.1:1" or runtime["manifest"]["files"]:
            raise RuntimeError("Isolated package generated unexpected runtime data")
        evidence = {"schema": 1, "status": "VERIFIED", "scope": "isolated-npm-package", "timestamp": datetime.now(timezone.utc).isoformat(), "artifact_sha256": hashlib.sha256(archive.read_bytes()).hexdigest(), "artifact_bytes": archive.stat().st_size, "files": len(names), "commands": ["npm pack --ignore-scripts", "node <unpacked>/dist/cli.js --help", "node <unpacked>/dist/cli.js build http://127.0.0.1:1 --prepare-only"], "native_build": "UNKNOWN: not executed by this e2e"}
        output = ROOT / "output/e2e/npm-package.json"; output.parent.mkdir(parents=True, exist_ok=True); output.write_text(json.dumps(evidence, indent=2) + "\n")
        print(f"VERIFIED[isolated.npm.package]=true bytes={evidence['artifact_bytes']} files={len(names)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
