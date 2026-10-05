"""Project-local verifier policy. Agents MAY extend it; every gate executes it fail-closed."""

CONFIG = {
    "coverage_min": 60,
    "lint_command": None,          # None → `make lint` (uv run ruff check . | bunx oxlint --deny-warnings).
    "test_command": None,          # None → `make test`. Commands run in the repo root.
    "coverage_command": None,      # None → `make coverage`; output needs `TOTAL <n>%` or an `All files |…|` table.
    "integration_commands": [],    # [] → `make integration` if present.
    "e2e_commands": [],            # [] → `make e2e`: build + consume the publishable artifact.
    "timeout_s": 180,
    "layout": True,                # Makefile verbs + gitignored var/log/ and tmp/.
    "toolchain": True,             # new (sub)projects start on bun (JS/TS) / uv (Python): newly added npm/yarn/pnpm/poetry/pipenv/pdm/pip lockfiles fail.
    # WHY: renderHost copies every file under rust_templates/ into each generated host, so pages there would ship in
    # every app; the host and transport are documented in the root ARCH.md instead.
    "readme": {"exclude": ["rust_templates", "rust_templates/*"]},
    "arch": {"exclude": ["rust_templates", "rust_templates/*"]},
}

# Deterministic invariants only; no semantic guesses.
# kinds: command | file_exists | contains | regex | not_regex
# scope: "path" = one exact file; "glob" = every changed code file matching (fnmatch).
RULES = [{
    "id": "tests.no-mocks",
    "kind": "not_regex",
    "glob": "*",
    # Every alternative contains an escape, so this file never matches its own pattern.
    "pattern": r"unittest\.mock|from\s+unittest\s+import\s+mock|MagicMock\(|mock\.patch|mocker\.|"
               r"jest\.(?:mock|fn|spyOn)\(|vi\.(?:mock|fn|spyOn)\(|sinon\.|gomock\.|mock\.Mock\b|Mockito\.|@Mock\s|mockk\(",
    "claim": "tests exercise real subsystems, not mock frameworks",
}, {
    "id": "docs.readme.env-keys",
    "kind": "command",
    "command": "python3 -c \"import re,sys; keys=re.findall(r'(?m)^([A-Z][A-Z0-9_]*)=', open('.env.example').read()); "
               "missing=[k for k in keys if chr(96)+k+chr(96) not in open('README.md').read()]; print('missing', missing) if missing else None; sys.exit(bool(missing))\"",
    "claim": "README.md documents every key in .env.example",
}, {
    "id": "docs.arch.diagram",
    "kind": "contains",
    "path": "ARCH.md",
    "text": "```mermaid",
    "claim": "ARCH.md keeps its pipeline diagram",
}, {
    # WHY: IDE checks and `cargo test` inside the templates create target/ and Cargo.lock there (2886 files once).
    "id": "repo.no-template-build-output",
    "kind": "command",
    "command": "! git ls-files --others --cached --exclude-standard rust_templates | grep -E '(^|/)target/|Cargo\\.lock$'",
    "claim": "Git never sees Cargo output or lock files inside rust_templates/",
}]
