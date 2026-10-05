# defuss-tauri engineering contract

This repository is the URL/folder replacement package, not the entire defuss monorepo.
Read README.md, ARCH.md, docs/NATIVE_GATES.md and .agents/MEMORY.md.

## Work loop

1. Inspect the actual source and the relevant contract. Find the cheapest falsifier.
2. Change the smallest causally related module. Add a real filesystem/process/socket regression test.
3. Run `make verify`; investigate failures, never turn missing tools or observations into passes.
4. Run the defuss-vae gate (`vae.py gate --repo .`) from the plugin installed in the harness; nothing is vendored.
5. Perform its review, then its documentation assessment, against the current fingerprint. Do not create
   positive attestations without actually doing the required review. Source edits reopen the gate.
6. Native changes additionally require the relevant real platform tests. `make release-gate` is a
   separate, stronger boundary; `make verify` and VAE's fast gate are not native certification.

Skills remain human-triggered. Do not invoke upstream plan/implement/review/finalize skills autonomously.
Never replace a user's existing Git hooks.
VAE runtime logs and attestations live in ignored tmp/ and var/. Do not commit fabricated PASS evidence.

## Non-negotiable invariants

External services have no lifecycle representation. Never install the target's dependencies, spawn its
server, send it shutdown signals, scan/rewrite its port, or require it to be online during packaging.
Build-tool installation is separate and managed. The native app must not acquire Node/Bun/npm or SSG
resources, a shell plugin, duplicate asset copies, broad IPC access, or post-sign bundle mutations.

Only `src/tooling.ts` may spawn build processes. Rust may own a static-byte HTTP listener, not execute
application/backend code. Keep URL origins exact; keep directory origins persistent. Unknown native
API behavior stays UNKNOWN. Do not spoof isSecureContext, navigator.serviceWorker, or TLS trust.
Self-signed TLS adapters are NOT_IMPLEMENTED, not "enabled by developer mode".

Generated files are hash-owned. Refuse edits/conflicts instead of deleting customizations. Publish only
selected static assets. Preserve `.well-known`; reject secrets, dependency trees and symlink escapes.
Use explicit include prefixes for intentional static browser modules, not whole-project staging.

## Verification boundary

Fast tests execute compiled JS, real files/processes, isolated Git repos and a real npm tarball. They do
not compile Rust. Native socket tests and WebView probes are separate. Never substitute Chromium or
Safari for the actual embedded WebView when making a native support claim. Reports must retain the
source fingerprint, platform/profile, binary and Cargo.lock digests, OS/runtime versions and observations.

For a monorepo copy, merge the VAE policy at the actual Git root; do not weaken root-scope
checks to make a nested package's unrelated Git paths appear verified.

<!-- defuss-vae:start -->
## defuss-vae
Read `.agents/MEMORY.md` + `.agents/CLI_GIST.md` before engineering work; `grep` `.agents/EPISODES.md` for recurring failures.
Skills `plan` `implement` `review` `finalize` are human-triggered only; never auto-invoke them. Outside skills write plain concise prose.
Evidence > assumption: IF a runtime fact is unknown THEN observe before editing (read → existing test/command → smallest discriminating probe → ask). Temporary probe lines carry `vae:probe` and the gate rejects leftovers; read logs bounded (`make log`, tail, grep); no log spraying.
Layout: `.agents/` agent state; `Makefile` verbs setup start stop status log metrics bench test coverage lint e2e verify; services only via `make start` → `var/log/<svc>.stdout|.stderr`, `tmp/<svc>.pid` (gitignored); programs read `input/`, write `output/` (both gitignored; commit e2e fixtures via `!input/<file>`).
test = real subsystems in isolation, no mocks; e2e = build the publishable artifact and consume it like a user; a web frontend's e2e drives the built app, served via `make start`, in a real Playwright browser (`bun add -d playwright` + `bunx playwright install --with-deps chromium` | `uv add --dev playwright` + `uv run playwright install --with-deps chromium`) with what the app needs enabled: WebGL2 (GPU-less CI: launch args `--use-angle=swiftshader --enable-unsafe-swiftshader`), real network, permissions via `context.grantPermissions([...])` (Python `grant_permissions`); assert rendered output, fail on console errors and failed requests, and write the report (`outputDir`) to `output/`. The gate fails closed without `.agents/VERIFY.py`, any verb, or `verify` running lint test coverage e2e, and when e2e leaves no fresh file in `output/`. A library without a service keeps the layout: `init` adds the ignores and one Makefile line `start stop restart status log: ; @echo "∅ $@: no service"` covers the service verbs; never disable `layout` for that. lint = `uv run ruff check .` (Python) | `bunx oxlint --deny-warnings` (JS/TS; plain oxlint exits 0 on findings). verify = lint + test + coverage + e2e; CI on a GitHub remote is `.github/workflows/verify.yml` running `make setup` then `make verify`.
Toolchain: new projects and subprojects start on `bun` (JS/TS, `bun init`) or `uv` (Python, `uv init`), never npm/yarn/pnpm/pip/poetry; the gate rejects newly added foreign lockfiles. In uv projects use `uv run`/`uv add`, not venv activation, which agent shells do not keep. A repo already on another toolchain keeps it unless the human approves migrating; propose it. Missing uv/bun: `make setup` installs them with the official installers (brand-new project: `curl -LsSf https://astral.sh/uv/install.sh | sh`, `curl -fsSL https://bun.sh/install | bash`).
Habits: separate concerns (pure core logic; I/O, config and framework glue at the edges) in small single-purpose modules testable with real inputs; split by responsibility, never speculatively. Logs: one line per event, ISO-8601 UTC timestamp first (`2026-10-01T12:00:00.123Z`), then level, message, key=value; never secrets. Config: env vars from a gitignored `.env` (bun loads it itself; Python `uv run --env-file .env`); every key the code reads stays in `.env.example` without secret values, updated in the same change (gate-checked); validate config once at startup and fail fast. Services exit cleanly on SIGTERM (`make stop`).
Epistemics: `VERIFIED` = direct evidence; `HYPOTHESIS` = testable inference + falsifier; `UNKNOWN` = not established. Never promote by rhetoric.
Ponytail: understand → YAGNI → reuse → stdlib → native → installed dependency → minimum code; bug fix = root cause + sibling callers.
Docs: why this design beats a plausible alternative; prefix material claims `VERIFIED:`, `HYPOTHESIS:` or `UNKNOWN:`.
Lessons: test | `.agents/VERIFY.py` rule > MEMORY line > EPISODES line.
<!-- defuss-vae:end -->
