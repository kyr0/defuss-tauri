# defuss-tauri

[![CI](https://github.com/kyr0/defuss-tauri/actions/workflows/verify.yml/badge.svg)](https://github.com/kyr0/defuss-tauri/actions/workflows/verify.yml)
[![License](https://img.shields.io/github/license/kyr0/defuss-tauri)](LICENSE)
[![Node](https://img.shields.io/badge/node-20.19%2B-blue)](ARCH.md)

**One target in, a native app out: wrap one HTTP(S) URL or one static folder in a Tauri app for macOS, Windows, Linux, iOS or Android.**

A CLI that generates a small Rust host and runs a pinned Tauri CLI on it, **without putting Node, a dev server or your backend into the app**. Your framework, your toolchain and your server stay exactly as they are; defuss-tauri owns only the wrapper.

## TL;DR

Shipping a web app as a native app usually means shipping a runtime with it: a Node sidecar, a bundled static-site generator or a dev server the wrapper starts and stops for you. The wrapper then owns your lifecycle, decides how much of your framework it understands, and your app's origin and storage depend on whatever it chose.

defuss-tauri takes the one thing your toolchain already produces, a running URL or a built folder, generates a small Rust host and runs Tauri on it. It never builds, installs, starts or stops your application, so any framework works as long as it produces a URL or a folder. It replaces `kyr0/defuss/packages/tauri`, which shipped a Node sidecar and ran a static-site generator.

- 🎯 **Byte-exact URLs:** the URL opens exactly as given, including path, query and fragment, and packaging never contacts the service
- 📁 **A folder origin that survives restarts:** the folder is served from 127.0.0.1 on a port chosen once and kept, so the app's storage survives; release builds embed the selected files once
- 🔒 **Nothing extra ships:** secrets, VCS data, dependency trees and hidden files are excluded, `.well-known` is kept, and every symlink is rejected
- 🧾 **Hash-owned host files:** a generated file you edited is refused, never overwritten
- 🙅 **No lifecycle:** the CLI never installs the target's dependencies, starts or stops its server, scans its port or requires it to be online during packaging
- 👀 **Nothing writes silently:** `--dry-run` writes nothing, and `--prepare-only` generates the Rust host without any toolchain
- 🧯 **No bypassed certificates:** the app adds no TLS exceptions and edits no trust store; a self-signed dev server loads once its CA is installed on the OS or device (see below), and platforms without a real run are reported as open, never claimed

Status: this is not a certified release. [What "certified" means](#what-certified-means) lists what has evidence and what is still open.

## How it works

```mermaid
flowchart LR
    H([🙋 you]) -->|"one target:<br/>URL or folder"| V

    subgraph yours ["🧰 your toolchain, untouched"]
        U["dev server<br/>a URL you started"]
        F["static folder<br/>a build you produced"]
    end

    subgraph cli ["🖥️ CLI: validate · select · generate"]
        V["<b>validate</b><br/>config · platform<br/>toolchain probes"]
        S["<b>select</b><br/>folder assets by hash<br/>secrets & symlinks refused"]
        G["<b>generate</b><br/>hash-owned Rust host"]
        V --> S --> G
    end

    U -.->|"read only"| V
    F -.->|"read only"| V
    G --> T["<b>pinned Tauri CLI</b><br/>compiles and bundles"]
    T --> A["<b>native app</b><br/>URL: opened byte for byte<br/>folder: 127.0.0.1 listener, port kept<br/>release & mobile: assets embedded"]
```

| Stage | Who drives it | What it does |
|---|---|---|
| **target** | you and your toolchain | Produces the URL or the folder. The CLI only ever reads it. |
| **validate** | the CLI | Checks the configuration, the platform and the toolchain first, so Tauri's own installers never run; what is missing is listed, not installed. |
| **select** | the CLI, folder targets only | Picks the folder's files by explicit prefixes and hashes them, refusing secrets, dependency trees and symlinks instead of staging the project wholesale. |
| **generate** | the CLI | Writes the Rust host and owns its files by hash: an edited file stops the run, it is never silently replaced. Tauri's `gen/` project belongs to you and Tauri and is never regenerated. |
| **build** | a pinned Tauri CLI, installed into the managed directory | Compiles and bundles the host. |
| **run** | the Rust host inside the app | Opens a URL byte for byte, or serves the selected files from a 127.0.0.1 listener whose port is chosen once and kept. The host executes no application or backend code; the platform WebView runs your frontend. |

[ARCH.md](ARCH.md) explains why this design beats the plausible alternatives, plus the module boundaries and the security model.

## Your app stays yours

defuss-tauri does not ship a one-size-fits-all scaffold. It enforces a small **contract**, and any project that already meets it works unchanged.

- **Any framework, one contract.** Your toolchain produces a running URL or a folder of files; everything before that point is yours. *Why:* a wrapper that understood frameworks would age with every one of them.
- **No lifecycle representation.** The CLI never installs the target's dependencies, spawns its server, sends it shutdown signals, scans or rewrites its port, or requires it to be online during packaging. *Why:* a process the CLI cannot observe cannot be managed, only corrupted.
- **Selection, not staging.** Assets are chosen by exact path prefixes, secret and VCS exclusions always win, and `.well-known` is preserved. *Why:* whole-project staging ships your `node_modules`, your build cache and, eventually, a secret.
- **Generated files are hash-owned.** Edit one and the CLI refuses to run instead of deleting your customization; signing and other changes in Tauri's `gen/` directory survive every run. *Why:* a generator that silently overwrites teaches you never to touch its output, which breaks the moment you must.
- **Unknown stays `UNKNOWN`.** The app never bypasses certificate errors or edits trust stores — self-signed HTTPS means a CA you install (see below) — and secure-context and service-worker claims come only from probes in the real embedded WebView, never from Chromium or Safari, with unproven platforms staying open in [docs/NATIVE_GATES.md](docs/NATIVE_GATES.md). *Why:* a support claim without evidence is worse than none.

## Quick start

Requirements: Node >= 20.19 for the CLI; the unit tests import the TypeScript sources through Node's
built-in type stripping, so development needs a Node release that enables it by default. Bun installs
the development dependencies (`make setup` installs Bun if it is missing), and for `dev` or `build` Rust (`cargo`, `rustc`) plus
[Tauri's OS prerequisites](https://v2.tauri.app/start/prerequisites/). Generated apps need macOS 14 or
iOS 17 or later. Tested on 2026-10-05 with Node 24.14 and rustc 1.96 on macOS 15.7 (arm64).

```bash
bun install
make example-static ARGS=--prepare-only
```

It prints `Prepared <repo>/examples/static; 2 selected assets (1306 bytes). Host: <repo>/tmp/examples/static/managed/dev/src-tauri`.
`make example-static` without arguments compiles that host and opens the example in a native window. The
first run also installs the pinned Tauri CLI into the managed directory, which takes a few minutes.

## Usage

The examples run the published package with `bunx defuss-tauri`; from a checkout the same interface is
`node dist/cli.js` after `make setup` has built `dist/`. Without a command the CLI runs `dev`; without a
target it uses `./defuss-tauri.json`, else the current directory.

### Dev: wrap a running server or a folder

```text
bunx defuss-tauri dev http://127.0.0.1:5173   # wrap a running dev server
bunx defuss-tauri dev ./public                # serve a folder from inside the app
```

Start the service behind a URL yourself; defuss-tauri never supervises it.

### Build: package the target

```text
bunx defuss-tauri build ./dist                         # package a built folder
bunx defuss-tauri build --config app/defuss-tauri.json # use a configuration file
```

### Init: write a configuration file

```text
bunx defuss-tauri init --app-name "My App"    # write defuss-tauri.json
```

### Doctor: report toolchain and configuration findings

```text
bunx defuss-tauri doctor
bunx defuss-tauri doctor --platform ios       # lists exactly what is missing
```

| Option | Meaning |
|---|---|
| `--config <file>` | JSON configuration; no search in parent directories |
| `--entry <file.html>` | HTML entry of a folder; default `index.html` or the only HTML file in the folder root |
| `--platform <native\|macos\|windows\|linux\|ios\|android>` | Target platform; desktop targets must match the build machine |
| `--rust-target <triple>` | Desktop Rust target; `--target` is a deprecated alias |
| `--app-name`, `--identifier`, `--version` | App metadata (`--version` is the app's semantic version) |
| `--managed-dir <dir>` | Generated hosts; default `.defuss-tauri` |
| `--tauri-out <dir>` | Cargo build output; default `dist-tauri-dev` or `dist-tauri-build` |
| `--port`, `-p <port>` | Fixed port of the folder transport; otherwise chosen once and kept |
| `--strict-security` | Disables the WebView inspector |
| `--prepare-only` | Generate the host, run no toolchain |
| `--skip-install` | Never install the managed Tauri CLI |
| `--dry-run` | Read and validate only: no writes, commands or network |
| `--debug`, `-d` | Verbose native tool output (not a Cargo debug build) |

Removed flags of the old package (`--host`, `--skip-ssg`, `--node-version` and others) fail with a
migration hint.

### Folder targets

Files are selected, not copied wholesale. Excluded by default: secrets (`.env*`, `*.pem`, `*.key`,
`*.p12`, `*.pfx`, SSH keys), VCS directories, dependency trees (`node_modules`, `vendor`), build output
and hidden files; `.well-known` is kept. `assets.include` and `assets.exclude` are exact path prefixes,
not globs: include a browser-only dependency with e.g. `"include": ["node_modules/my-esm"]`. Secret and
VCS exclusions always win. Every symlink is rejected, including links inside the folder; copy the bytes
instead.

The SPA fallback (`assets.spa`) serves the entry page only for page navigations to paths without a file
extension, so a missing `sw.js`, module or WASM file stays a 404. In desktop `dev`, edits to existing
files show up on reload; new files need a restart. The native menu's "Reload configured target"
(Cmd/Ctrl+R) reloads.

### URL targets

The URL is used byte for byte. Diagnostic output hides its query and fragment, but the full URL is
compiled into the app, so a token in it is not secret. `https://user:password@host` is rejected; log in
through the service instead. HTTPS uses the platform's certificate validation; a self-signed certificate
fails unless its CA is installed (see below). There is no offline screen of its own: if the service is
down, the WebView shows its error page; start the service and use Reload.

### Mobile (iOS and Android)

```text
bunx defuss-tauri doctor --platform ios          # lists exactly what is missing
bunx defuss-tauri dev --platform ios             # Tauri asks which simulator or device
bunx defuss-tauri build --platform android
make example-static ARGS="--platform android"
```

The CLI never installs SDKs, Homebrew packages or Rust targets; it checks them first so Tauri's own
installers never run. `make setup-ios` and `make setup-android` install them on request:

- **iOS** (macOS only): Xcode;
  `rustup target add aarch64-apple-ios x86_64-apple-ios aarch64-apple-ios-sim`;
  `brew install xcodegen cocoapods libimobiledevice`. Device builds need a signing team in
  `APPLE_DEVELOPMENT_TEAM`. The minimum is iOS 17.
- **Android**: SDK (`ANDROID_HOME`), NDK (`NDK_HOME`), a JDK on `PATH`;
  `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`.
  Identifier segments may not contain hyphens, because they become a Java package name.

Both targets skip what is already installed and end with `doctor`, which fails while anything is
missing. The Android command-line tools (build 16111833) are downloaded from Google and checked against a
pinned SHA-1; the SDK goes to `ANDROID_HOME` (default `~/Library/Android/sdk` on macOS, `~/Android/Sdk` on
Linux) with platform 37.0, build-tools 37.0.0 and NDK 30.0.16248370. Virtual devices are opt-in because
they take several GB: `make setup-ios SIMULATOR=1` adds the iOS Simulator runtime,
`make setup-android EMULATOR=1` the emulator, an API 37 system image and an AVD named `defuss-tauri`.
They refuse to start below 12 and 9 GB free disk. Outside make, export the `ANDROID_HOME` and
`NDK_HOME` that `make setup-android` prints.

The first run creates Tauri's Xcode or Gradle project in `.defuss-tauri/<ios|android>-<dev|release>/src-tauri/gen/`.
That directory is yours and Tauri's: defuss-tauri never regenerates or deletes it, so signing and other
changes stay there.

- Folder targets embed their files even in `dev`, because a phone cannot read this disk; restart `dev`
  after changing files.
- A loopback URL means the device itself. The iOS Simulator shares the Mac's loopback; an iOS `build`
  with a loopback URL is refused. Android `dev` runs `adb reverse tcp:<port> tcp:<port>`, so start the
  emulator or connect the device first.
- Window size, menus and `--rust-target` apply to desktop only.

Permissions are permissive by default. Web content may load plain HTTP and local addresses, and gets
camera, microphone and location after the operating system's prompt:

- **iOS** (and the macOS bundle): ATS allows HTTP in web content and local networking; generic usage
  texts cover camera, microphone, location, local network and photo library. App Store submission
  needs your own wording in the generated project.
- **Android**: a project created by defuss-tauri allows cleartext HTTP to every host, trusts
  user-installed CAs and declares camera, microphone and location permissions with the hardware marked
  optional. Existing projects are never edited.
- **Self-signed HTTPS**: issue the dev server's certificate from a local CA and install that CA on the
  device. Any issuer works: `mkcert`, smallstep (`step certificate create` or a local `step-ca`), or
  Caddy with an external certificate (`tls <cert> <key>`); Caddy's internal CA additionally installs
  its root into the system trust store itself (`caddy trust`), a developer-machine convenience the app
  neither performs nor requires. Android trusts it through the configuration above; on iOS also enable
  it under Settings → General → About → Certificate Trust Settings. This CA-install path is the decided
  model: the app implements no TLS exception handlers and never modifies trust stores. Certificate
  errors are never bypassed.
- Android WebView and WKWebView do not implement Web Notifications, whatever the permissions say.

`make mobile-check` compiles the generated host for the iOS Simulator and Android; no simulator or
device run has been done yet.

### Custom Rust extensions (opt-in)

The default host is wrapper-only: no commands, no plugins, no user Rust code. When you want native
code anyway, point `rust.extensions` at crates you own and they ship through normal defuss-tauri
builds:

```json
{
  "target": "./public",
  "rust": {
    "extensions": [
      {
        "path": "./rust/native-logins",
        "package": "native-logins",
        "capabilities": [
          { "identifier": "native-logins", "windows": ["main"], "permissions": ["core:default"] }
        ]
      }
    ]
  }
}
```

- Each extension is a **plain Rust library crate on your disk**; defuss-tauri never copies or parses
  it. The generated host gains a renamed path dependency and calls, first in its builder chain, the
  one function the contract requires: `pub fn defuss_tauri_extend(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry>`.
  Register commands, plugins or navigation gating there; a wrong signature is a compile error.
- `capabilities` entries are Tauri v2 capability objects, rendered verbatim into
  `src-tauri/capabilities/` and enabled by identifier. Without them your commands stay unroutable.
- Validation fails closed: the path must exist as a real directory with a regular `Cargo.toml`, be
  relative to the configuration file, and live outside the managed and output directories;
  `--dry-run` checks all of it without writing.
- *Why path references instead of copying:* your crate keeps one owner and one edit location, no
  source duplication enters the generated tree, and the fail-closed ownership guards stay intact.
  The trade is explicit and yours: extension code runs inside the app with full Rust capability, so
  it gets the review a native change deserves.
- A runnable example lives in [examples/rust-extension](examples/rust-extension): its extension adds
  a custom *Rust Extension* menu to the application menu bar and logs every page load to the
  terminal, with no web-facing API, and the app icon comes from `assets/icon.*` via `icons`. Open it
  with `make example-rust-extension`. The compile-checked fixture used by the test suite is
  [tests/fixtures/rust-ext](tests/fixtures/rust-ext); `make native-test` type-checks both hosts
  with `-D warnings`.

### App icons

`icons` lists icon files you own — `.png`, `.ico` or `.icns`; anything else is rejected with the
supported list. The files are copied into the generated host as hash-owned files and drive the
bundle icons; without the setting the template icons apply. Validation is fail-closed like every
other input: existing regular files only, no symlinks, outside the managed and output directories,
and `--dry-run` checks without writing. [examples/rust-extension](examples/rust-extension/defuss-tauri.json)
sets `"icons": ["./assets/icon.png", "./assets/icon.ico", "./assets/icon.icns"]`.

## Configuration

`defuss-tauri.json` in the invocation directory, or the file given with `--config`:

```json
{"target": "http://127.0.0.1:5173"}
```

```json
{
  "target": "./public",
  "entry": "game.html",
  "appName": "My Game",
  "identifier": "dev.example.game",
  "version": "1.0.0",
  "window": {"width": 1280, "height": 800, "resizable": true},
  "assets": {"spa": false, "headers": {"Cross-Origin-Opener-Policy": "same-origin"}}
}
```

| Key | Meaning | Default |
|---|---|---|
| `target` | HTTP(S) URL or folder | the current directory |
| `entry` | HTML entry inside the folder, may be nested | `index.html`, else the only root HTML file |
| `appName` | Product name; must be a valid file name | folder name or URL host |
| `identifier` | Reverse-DNS app identifier; dev builds append `.dev` | derived from the target location |
| `version` | Semantic version `x.y.z` | `0.1.0` |
| `platform`, `rustTarget` | As the CLI options | `native`, none |
| `managedDirName`, `tauriOutDir` | As `--managed-dir`, `--tauri-out` | see options |
| `icons` | App icon files (`.png`, `.ico`, `.icns`), relative to the file | none |
| `rust` | Opt-in native code: `extensions` with `path`, `package`, optional `capabilities` | none |
| `security` | `developer` (WebView inspector on) or `strict` | `developer` |
| `window` | `title`, `width`, `height`, `resizable`, `fullscreen` (desktop) | `appName`, 1280, 800, `true`, `false` |
| `assets` | Folder only: `port`, `spa`, `include`, `exclude`, `headers` | none, `false`, `[]`, `[]`, `{}` |

CLI options override the file, which overrides defaults. Paths in the file are relative to the file;
CLI paths are relative to the working directory. Set a stable `identifier` before distributing: the
default changes when the folder moves, and storage is tied to it. `assets.headers` may not set
transport-owned headers such as `content-length`. `defuss-tauri.schema.json` gives editors completion;
its `$id` is an identifier, not a hosted URL.

Environment variables ([.env.example](.env.example)); the CLI reads the shell environment and loads no `.env` file:

| Key | Meaning | Default |
|---|---|---|
| `ANDROID_HOME` | Android SDK directory | none; required for Android |
| `ANDROID_SDK_ROOT` | Legacy name, used when `ANDROID_HOME` is unset | none |
| `NDK_HOME` | Android NDK directory | none; required for Android |
| `DEFUSS_TAURI_PROBE_OUTPUT` | Report path of a probe-feature binary, set by `make native-probe` | none |
| `DEFUSS_TAURI_PROBE_RUN_ID` | Run token of a probe-feature binary, set by `make native-probe` | none |

## What "certified" means

A claim on this page exists only with direct evidence; what has none stays `UNKNOWN`, and `UNKNOWN` is
never presented as working. Each layer below proves only its own scope:

- `VERIFIED:` (`make test`, `make coverage`) the CLI's validation, asset selection and host generation,
  against real files, processes and isolated Git repositories; coverage is V8 line coverage of the
  TypeScript sources, not Rust or branch coverage
- `VERIFIED:` (`make e2e`) the packed npm tarball consumed like a user: its CLI runs against real
  fixture targets
- `VERIFIED:` (`make native-test`) the transport socket tests pass, and the generated host resolves as
  one Cargo workspace and type-checks warning-free for every feature set
- `VERIFIED:` (`make mobile-check`) the generated host type-checks warning-free for the iOS Simulator
  and Android; no simulator or device run yet
- `VERIFIED:` (`make native-probe`, macOS, folder target) the real embedded WebView runs the app twice:
  secure context, service worker, storage that survives a restart

Everything else is still open: URL targets, HTTPS with an installed self-signed CA, upgrade and distribution scopes, and any run
on Windows, Linux, iOS or Android. `make release-gate` is the certification boundary: 27 platform,
profile and scope reports must exist and match the current source, and only the folder-loopback scope has
a runner so far. [docs/NATIVE_GATES.md](docs/NATIVE_GATES.md) lists the open native work.

## Development

```bash
make setup && make verify
```

`make setup` installs dependencies with Bun and builds `dist/` with pkgroll (bundled `index.js`, `cli.js`
and `index.d.ts`). `make verify` runs the TypeScript type check, oxlint with warnings denied, the
architecture policy, Node and Python tests against real files and processes, coverage and an end-to-end
test of the packed npm tarball. Unit tests and coverage run on `src/*.ts` directly; the end-to-end tests
run the built `dist/`. It compiles no Rust. CI runs `make setup` and `make verify` on every push
(`.github/workflows/verify.yml`).

The engineering gate is the defuss-vae plugin installed in the agent harness, not a copy in this
repository. Its gate (`vae.py gate --repo .`) checks the changed files against `.agents/VERIFY.py` and
runs `make lint`, `make test`, `make coverage` and `make e2e`; its skills run only when a person invokes
them.

## Details

- Project website (built with [defuss-shadcn](https://shadcn.defuss.org/index.html)): [docs/index.html](docs/index.html)
- Architecture and security model: [ARCH.md](ARCH.md)
- Open native work and the release gate: [docs/NATIVE_GATES.md](docs/NATIVE_GATES.md)
- Configuration schema for editors: [defuss-tauri.schema.json](defuss-tauri.schema.json)
- Environment variables: [.env.example](.env.example)
- Examples: [examples/static](examples/static), [examples/url](examples/url), [examples/rust-extension](examples/rust-extension)
- Contributing: [AGENTS.md](AGENTS.md); run `make setup && make verify`

## Citation

If you use defuss-tauri in research or want to reference it, cite it as:

```bibtex
@misc{homberg2026defusstauri,
  author       = {Homberg, Aron},
  affiliation  = {Independent Researcher},
  title        = {defuss-tauri: Framework-Independent Tauri Launcher},
  year         = {2026},
  version      = {0.3.0},
  howpublished = {\url{https://github.com/kyr0/defuss-tauri}},
  note         = {CLI for HTTP(S) URLs and static directories, MIT License}
}
```

## License

MIT, see [LICENSE](LICENSE).
