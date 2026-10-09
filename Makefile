PYTHON ?= python3
NODE ?= node
PROFILE ?= dev
# Bun's official installer puts it here; exported so a fresh install works in the same make run.
export PATH := $(HOME)/.bun/bin:$(PATH)
# Android defaults matching tools/setup_mobile.py; values already in the environment win.
export ANDROID_HOME ?= $(if $(filter Darwin,$(shell uname)),$(HOME)/Library/Android/sdk,$(HOME)/Android/Sdk)
export NDK_HOME ?= $(lastword $(sort $(wildcard $(ANDROID_HOME)/ndk/*)))

.PHONY: setup setup-ios setup-android build lint test coverage e2e verify native-test mobile-check native-probe release-gate start stop status log metrics bench demo example-static example-url example-rust-extension
# A missing Bun is installed with its official installer (CI runners have none).
setup:
	command -v bun >/dev/null || curl -fsSL https://bun.sh/install | bash
	bun install --frozen-lockfile
	$(MAKE) build
# Opt-in mobile prerequisites; the CLI itself never installs them. SIMULATOR=1 / EMULATOR=1 add the large
# virtual-device parts behind a free-disk guard. Each ends with doctor, which fails while anything is missing.
setup-ios: build
	$(PYTHON) tools/setup_mobile.py ios $(if $(filter 1,$(SIMULATOR)),--simulator)
	$(NODE) dist/cli.js doctor --platform ios examples/static
setup-android: build
	$(PYTHON) tools/setup_mobile.py android $(if $(filter 1,$(EMULATOR)),--emulator)
	# make caches $(wildcard) listings, so an NDK installed by the line above is resolved by the shell here.
	NDK_HOME="$${NDK_HOME:-$$(ls -d "$$ANDROID_HOME"/ndk/* 2>/dev/null | sort | tail -1)}" $(NODE) dist/cli.js doctor --platform android examples/static
build:
	bun run build
lint:
	bun run lint
test: build
	$(NODE) --test tests/config.test.mjs tests/assets.test.mjs tests/docs.test.mjs
	$(PYTHON) -m unittest discover -s tests -p 'test_*.py' -v
coverage: build
	$(NODE) tools/coverage.mjs
e2e: build
	$(NODE) --test tests/e2e.test.mjs
	$(PYTHON) tools/pack_test.py
verify: lint test coverage e2e
native-test: build
	# Build output stays in ignored tmp/, never inside the published rust_templates tree.
	CARGO_TARGET_DIR=$(CURDIR)/tmp/native-test cargo test --manifest-path rust_templates/transport/Cargo.toml
	# A generated host must resolve as one Cargo workspace; metadata catches root conflicts without compiling.
	$(NODE) dist/cli.js build --config examples/static/defuss-tauri.json --prepare-only --managed-dir tmp/native-test/host --tauri-out tmp/native-test/out
	cargo metadata --no-deps --format-version 1 --manifest-path tmp/native-test/host/release/src-tauri/Cargo.toml > /dev/null
	# Every shipped feature set compiles warning-free; URL hosts build without static-assets.
	for features in "" --no-default-features --all-features; do \
		CARGO_TARGET_DIR=$(CURDIR)/tmp/native-test/check RUSTFLAGS="-D warnings" cargo check --quiet --manifest-path tmp/native-test/host/release/src-tauri/Cargo.toml $$features || exit 1; \
	done
	# Opt-in rust.extensions hosts compile warning-free with their user crates (fixture and example, real cargo check).
	$(NODE) dist/cli.js dev --config tests/fixtures/rust-ext-project/defuss-tauri.json --prepare-only --managed-dir tmp/native-test/ext-managed --tauri-out tmp/native-test/ext-out
	CARGO_TARGET_DIR=$(CURDIR)/tmp/native-test/check RUSTFLAGS="-D warnings" cargo check --quiet --manifest-path tmp/native-test/ext-managed/dev/src-tauri/Cargo.toml
	$(NODE) dist/cli.js dev --config examples/rust-extension/defuss-tauri.json --prepare-only --managed-dir tmp/native-test/example-ext-managed --tauri-out tmp/native-test/example-ext-out
	CARGO_TARGET_DIR=$(CURDIR)/tmp/native-test/check RUSTFLAGS="-D warnings" cargo check --quiet --manifest-path tmp/native-test/example-ext-managed/dev/src-tauri/Cargo.toml
# Cross-compiles generated iOS-Simulator/Android hosts warning-free (needs both Rust targets; iOS needs macOS).
# Compilation only: on-device behaviour stays UNKNOWN until a simulator/device probe runs.
mobile-check: build
	for p in ios android; do $(NODE) dist/cli.js dev --config examples/static/defuss-tauri.json --platform $$p --prepare-only --managed-dir tmp/mobile-check/managed --tauri-out tmp/mobile-check/out || exit 1; done
	for t in aarch64-apple-ios-sim:ios aarch64-linux-android:android; do \
		for features in "" --no-default-features --all-features; do \
			CARGO_TARGET_DIR=$(CURDIR)/tmp/mobile-check/target RUSTFLAGS="-D warnings" cargo check --quiet --lib --target $${t%%:*} --manifest-path tmp/mobile-check/managed/$${t##*:}-dev/src-tauri/Cargo.toml $$features || exit 1; \
		done; \
	done
native-probe: build
	$(PYTHON) tools/native.py --profile $(PROFILE)
release-gate:
	$(PYTHON) tools/release_gate.py
# Uniform VAE layout without assuming ownership of any target service.
start stop status log:
	@echo "No managed application service. Use demo to launch the native example."
metrics:
	$(PYTHON) -c "from pathlib import Path; p=Path('output/coverage.json'); print(p.read_text() if p.exists() else 'UNKNOWN: run make coverage')"
bench:
	@echo "UNKNOWN: native size/performance baseline not measured; see docs/NATIVE_GATES.md"
# Examples: CMD=dev|build, ARGS e.g. --prepare-only. Generated hosts go to ignored tmp/, not examples/.
CMD ?= dev
example-static: build
	$(NODE) dist/cli.js $(CMD) --config examples/static/defuss-tauri.json --managed-dir tmp/examples/static/managed --tauri-out tmp/examples/static/out $(ARGS)
# Serve http://127.0.0.1:5173 yourself first; the wrapper never starts or stops it.
example-url: build
	$(NODE) dist/cli.js $(CMD) --config examples/url/defuss-tauri.json --managed-dir tmp/examples/url/managed --tauri-out tmp/examples/url/out $(ARGS)
# The rust.extensions example: a custom Rust menu and terminal logging, no web-facing API.
example-rust-extension: build
	$(NODE) dist/cli.js $(CMD) --config examples/rust-extension/defuss-tauri.json --managed-dir tmp/examples/rust-extension/managed --tauri-out tmp/examples/rust-extension/out $(ARGS)
demo: example-static
