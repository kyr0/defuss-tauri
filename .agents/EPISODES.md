# Episodes

<!-- Newest last. The gate appends FAIL|DONE|FINDING and keeps the last 100 entries (git keeps older ones).
Agents append `<UTC ISO> s=<session> LESSON <VAE-DIALECT>` only for a falsified HYPOTHESIS, a dead end, or a root cause.
A lesson recurring ≥2 → test | .agents/VERIFY.py rule | MEMORY line, then delete its lines. -->

2026-10-05T22:48:43Z s=7c6320cb DONE fp=d42a907e548b cov=92.3% paths=AGENTS.md,ARCH.md,Makefile,README.md(+47)
2026-10-05T22:48:43Z s=7c6320cb FINDING .gitignore (rust_templates/**/target/, rust_templates/**/Cargo.lock) learn=verifier: .agents/VERIFY.py repo.no-template-build-output passes now and fails with the ignore lines removed
2026-10-05T22:48:43Z s=7c6320cb FINDING Makefile:setup/gate/agent-init; tools/bootstrap_vae.py; tools/agent.py; tools/vae.lock.json learn=none: adapter, its 9 tests and the policy.py lock requirement removed; no code path can reintroduce it, so a rule would only test for a file name
2026-10-05T22:48:43Z s=7c6320cb FINDING README.md:Development learn=verifier: vae.py prose flags broken relative links (T04)
2026-10-05T22:48:43Z s=7c6320cb FINDING ARCH.md:Operations, AGENTS.md:11,18, docs/MIGRATION.md:VAE at a monorepo root learn=none: descriptive text; reviewed, not mechanically checkable
2026-10-05T22:48:43Z s=7c6320cb FINDING .agents/MEMORY.md:gate.vacuous learn=memory: stale line deleted
2026-10-05T22:48:43Z s=7c6320cb FINDING src/tooling.ts:1 learn=none: comment accuracy is reviewed, not mechanically checked
2026-10-05T22:48:43Z s=7c6320cb FINDING tools/native.py:4, docs/NATIVE_GATES.md:3, README.md:Status learn=none: run-dependent status; native.py docstring rewritten to be run-independent
2026-10-05T22:57:45Z s=7c6320cb DONE fp=c2da6ca95da1 cov=93.3% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,Makefile(+47)
2026-10-05T22:57:45Z s=7c6320cb FINDING tests/assets.test.mjs:5-8, tests/config.test.mjs:5-9, tools/coverage.mjs:6 learn=test: tests now import src/*.ts via Node type stripping (30/30 pass); e2e and tools/pack_test.py still consume the built and packed dist
2026-10-05T22:57:45Z s=7c6320cb FINDING src/config.ts:17, src/target.ts:14,24 learn=test: one hasControlCharacter helper replaces the three regexes; new cases reject \u0001 and \u007f in URLs, window.title and appName; oxlint now part of make lint
2026-10-05T22:57:45Z s=7c6320cb FINDING Makefile:setup/build learn=none: PATH exported at the top of the Makefile; this machine already has Bun, so the first CI run is the real test
2026-10-05T23:02:04Z s=7c6320cb DONE fp=34e7e5fe1fd4 cov=93.8% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,Makefile(+47)
2026-10-05T23:02:04Z s=7c6320cb FINDING tests/assets.test.mjs:5-8, tests/config.test.mjs:5-9, tools/coverage.mjs:6 learn=test: tests now import src/*.ts via Node type stripping (30/30 pass); e2e and tools/pack_test.py still consume the built and packed dist
2026-10-05T23:02:04Z s=7c6320cb FINDING src/config.ts:17, src/target.ts:14,24 learn=test: one hasControlCharacter helper replaces the three regexes; new cases reject \u0001 and \u007f in URLs, window.title and appName; oxlint now part of make lint
2026-10-05T23:02:04Z s=7c6320cb FINDING Makefile:setup/build learn=none: PATH exported at the top of the Makefile; this machine already has Bun, so the first CI run is the real test
2026-10-05T23:02:04Z s=7c6320cb FINDING src/index.ts:doctorDefussTauri learn=test: tests/config.test.mjs 'doctor reports mobile prerequisites even when the target does not resolve' failed before the fix and passes after
2026-10-05T23:10:32Z s=7c6320cb LESSON HYPOTHESIS[make.wildcard.recipe-time] falsified: `export NDK_HOME ?= $$(wildcard …)` stayed empty for an NDK installed earlier in the same make run (make caches directory listings); resolve such paths in the recipe shell
2026-10-05T23:11:18Z s=7c6320cb DONE fp=c44f9567fbf5 cov=93.8% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,Makefile(+49)
2026-10-05T23:11:18Z s=7c6320cb FINDING Makefile:setup-android (doctor step) learn=memory: NDK_HOME now resolved by the recipe shell; second run doctor missing=[]; falsified hypothesis recorded in .agents/EPISODES.md
2026-10-05T23:11:18Z s=7c6320cb FINDING tools/setup_mobile.py:require_free_gb learn=test: virtual devices opt-in behind free-disk guards; tests/test_setup_mobile.py proves the guard refuses an impossible requirement
2026-10-05T23:11:18Z s=7c6320cb FINDING tools/setup_mobile.py:install_cmdline_tools learn=test: build 16111833 pinned with SHA-1 from Google's repository2-3.xml; tests prove a changed archive is rejected
2026-10-05T23:23:42Z s=7c6320cb DONE fp=0a175db4980c cov=93.8% paths=.github/workflows/verify.yml,AGENTS.md,ARCH.md,Makefile(+46)
2026-10-09T16:39:11Z s=7c6320cb DONE fp=446bfd4df341 cov=? paths=README.md
2026-10-09T16:42:58Z s=7c6320cb DONE fp=cda0ed3b418a cov=? paths=README.md
2026-10-09T16:55:48Z s=7c6320cb DONE fp=0bb418d43fb8 cov=? paths=README.md
