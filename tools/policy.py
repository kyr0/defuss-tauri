#!/usr/bin/env python3
"""Small deterministic architectural regression checks; no inferred semantic guarantees."""
from __future__ import annotations
import ast
import json
from pathlib import Path
import re
import sys
from fingerprint import ROOT


def check(root: Path = ROOT) -> list[str]:
    errors = []
    package = json.loads((root / "package.json").read_text())
    if package.get("dependencies") != {}:
        errors.append("production npm dependencies must remain empty")
    forbidden = re.compile(r"prepareNodeSidecar|ensureLocalDefussSsg|runLocalDefussSsg|stageProdApp|start_defuss_server|DefussSidecarState|copyResourcesToBundle|rebuildDmg|tauri_plugin_shell|tauri-plugin-shell|std::process::Command|Command::new\(")
    for folder in ("src", "rust_templates"):
        for path in (root / folder).rglob("*"):
            if not path.is_file() or path.suffix not in {".ts", ".rs", ".toml"} or "target" in path.parts or "tests" in path.parts:
                continue
            text = path.read_text()
            if forbidden.search(text):
                errors.append(f"removed lifecycle machinery in {path.relative_to(root)}")
            if path.suffix == ".ts" and "node:child_process" in text and path.name != "tooling.ts":
                errors.append(f"subprocess creation escaped tooling module: {path.name}")
    cargo = (root / "rust_templates/Cargo.toml").read_text()
    if 'default = ["static-assets"]' not in cargo or re.search(r'default\s*=\s*\[[^\]]*"probe"', cargo):
        errors.append("default native feature boundary changed")
    if 'tiny_http' not in (root / "rust_templates/transport/Cargo.toml").read_text():
        errors.append("HTTP must use its existing dependency, not a hand-written parser")
    for path in sorted((root / "tools").glob("*.py")):
        try:
            ast.parse(path.read_text(), filename=str(path))
        except SyntaxError as error:
            errors.append(str(error))
    for name, limit in (("MEMORY.md",4096),("CLI_GIST.md",2048)):
        path = root / ".agents" / name
        if not path.exists() or path.stat().st_size > limit:
            errors.append(f"agent state absent or over budget: {name}")
    for name in ("defuss-tauri.schema.json", "docs/NATIVE_GATES.md", ".agents/VERIFY.py", "tools/release_gate.py", "AGENTS.md"):
        if not (root / name).is_file():
            errors.append(f"required contract missing: {name}")
    return errors


if __name__ == "__main__":
    failures = check()
    for failure in failures:
        print(f"FAILED[policy]: {failure}")
    print(f"VERIFIED[policy]={'false' if failures else 'true'}")
    raise SystemExit(1 if failures else 0)
