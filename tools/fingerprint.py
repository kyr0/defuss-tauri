#!/usr/bin/env python3
"""Content-address native evidence to all code, tests, policy and build inputs.

VERIFIED: build outputs, evidence, VCS/dependencies and descriptive docs are not inputs.
"""
from __future__ import annotations
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TREES = ("src", "rust_templates", "tests", "tools", ".githooks", ".github", "examples")
FILES = ("package.json", "tsconfig.json", "Makefile", ".gitattributes", "defuss-tauri.schema.json", ".gitignore", ".env.example", "bun.lock", "bun.lockb", ".agents/VERIFY.py")


def source_fingerprint(root: Path = ROOT) -> str:
    paths: set[Path] = {root / name for name in FILES if (root / name).is_file()}
    for name in TREES:
        for path in (root / name).rglob("*"):
            relative = path.relative_to(root)
            if path.is_file() and not (name == "rust_templates" and path.name == "Cargo.lock") and not any(part in {"__pycache__", "target", "node_modules"} for part in relative.parts):
                paths.add(path)
    result = hashlib.sha256()
    for path in sorted(paths, key=lambda p: p.relative_to(root).as_posix()):
        if path.is_symlink():
            raise ValueError(f"Symlink input is not fingerprintable: {path}")
        result.update(path.relative_to(root).as_posix().encode() + b"\0")
        result.update(hashlib.sha256(path.read_bytes()).digest())
    return result.hexdigest()


if __name__ == "__main__":
    print(source_fingerprint())
