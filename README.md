# defuss-tauri

[![CI](https://github.com/kyr0/defuss-tauri/actions/workflows/verify.yml/badge.svg)](https://github.com/kyr0/defuss-tauri/actions/workflows/verify.yml)
[![License](https://img.shields.io/github/license/kyr0/defuss-tauri)](LICENSE)

A CLI that wraps one HTTP(S) URL or one static folder in a Tauri app for macOS, Windows, Linux, iOS or
Android, without putting Node, a dev server or your backend into the app.

## TL;DR

Your frontend toolchain already produces either a running dev server or a built folder. defuss-tauri
takes that URL or folder, generates a small Rust host and runs Tauri on it. It never builds, installs,
starts or stops your application, so any framework works as long as it produces a URL or a folder. It replaces `kyr0/defuss/packages/tauri`,
which shipped a Node sidecar and ran a static-site generator.

- URL targets open exactly as given, including path, query and fragment; packaging never contacts the
  service.
- Folder targets are served from 127.0.0.1 on a port that is kept across restarts, so the app's
  storage survives. Release builds embed the selected files once.
- Secrets, VCS data, dependency trees and hidden files are excluded; symlinks are rejected.
- Generated host files are hash-owned: edited files are refused, never overwritten.
- `--dry-run` writes nothing; `--prepare-only` generates the Rust host without any toolchain.

Status: this is not a certified release. The CLI and host generation are covered by tests. On macOS the
WebView probe passes for folder targets: secure context, service worker and storage that survives a
restart. URL, self-signed TLS, upgrade and distribution scopes, and Windows, Linux, iOS and Android runs
are still open; see [docs/NATIVE_GATES.md](docs/NATIVE_GATES.md).

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

```bash
node dist/cli.js dev http://127.0.0.1:5173            # wrap a running dev server
node dist/cli.js build ./dist                         # package a built folder
node dist/cli.js build --config app/defuss-tauri.json # use a configuration file
node dist/cli.js init --app-name "My App"             # write defuss-tauri.json
node dist/cli.js doctor                               # report toolchain and configuration findings
```

Without a command the CLI runs `dev`; without a target it uses `./defuss-tauri.json`, else the current
directory. Start the service behind a URL yourself; defuss-tauri never supervises it. After publishing,
the same interface is `bunx defuss-tauri`; this unpublished version is not on the registry.

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

```bash
node dist/cli.js doctor --platform ios          # lists exactly what is missing
node dist/cli.js dev --platform ios             # Tauri asks which simulator or device
node dist/cli.js build --platform android
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
- **Self-signed HTTPS**: issue the dev server's certificate from a local CA such as `mkcert` and install
  that CA on the device. Android trusts it through the configuration above; on iOS also enable it under
  Settings → General → About → Certificate Trust Settings. Certificate errors are never bypassed.
- Android WebView and WKWebView do not implement Web Notifications, whatever the permissions say.

`make mobile-check` compiles the generated host for the iOS Simulator and Android; no simulator or
device run has been done yet.

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
| `security` | `developer` (WebView inspector on) or `strict` | `developer` |
| `window` | `title`, `width`, `height`, `resizable`, `fullscreen` (desktop) | `appName`, 1280, 800, `true`, `false` |
| `assets` | Folder only: `port`, `spa`, `include`, `exclude`, `headers` | none, `false`, `[]`, `[]`, `{}` |

CLI options override the file, which overrides defaults. Paths in the file are relative to the file;
CLI paths are relative to the working directory. Set a stable `identifier` before distributing: the
default changes when the folder moves, and storage is tied to it. `assets.headers` may not set
transport-owned headers such as `content-length`. `defuss-tauri.schema.json` gives editors completion;
its `$id` is an identifier, not a hosted URL.

Environment variables (`.env.example`); the CLI reads the shell environment and loads no `.env` file:

| Key | Meaning | Default |
|---|---|---|
| `ANDROID_HOME` | Android SDK directory | none; required for Android |
| `ANDROID_SDK_ROOT` | Legacy name, used when `ANDROID_HOME` is unset | none |
| `NDK_HOME` | Android NDK directory | none; required for Android |
| `DEFUSS_TAURI_PROBE_OUTPUT` | Report path of a probe-feature binary, set by `make native-probe` | none |
| `DEFUSS_TAURI_PROBE_RUN_ID` | Run token of a probe-feature binary, set by `make native-probe` | none |

## How it works

The CLI validates the configuration, selects and hashes the folder's files, writes a Rust host whose
files it owns by hash, then runs a pinned Tauri CLI on it. The app opens a URL directly, or serves the
folder from an HTTP listener on 127.0.0.1 inside the app process. [ARCH.md](ARCH.md) explains why, the
module boundaries and the security model.

## Development

```bash
make setup && make verify
```

`make setup` installs dependencies with Bun and builds `dist/` with pkgroll (bundled `index.js`, `cli.js`
and `index.d.ts`). `make verify` runs the TypeScript type check, oxlint with warnings denied, the
architecture policy, Node and Python tests against real files and processes, coverage and an end-to-end
test of the packed npm tarball. Unit tests and coverage run on `src/*.ts` directly; the end-to-end tests
run the built `dist/`. It compiles no Rust; its coverage figure is V8 line coverage of the TypeScript
sources, not Rust or branch coverage. CI runs `make setup` and `make verify` on every push
(`.github/workflows/verify.yml`). Each layer below proves only its own scope:

| Command | Proves |
|---|---|
| `make native-test` | Transport socket tests; the generated host resolves as one Cargo workspace and type-checks warning-free for every feature set |
| `make mobile-check` | The generated host type-checks warning-free for the iOS Simulator and Android |
| `make native-probe PROFILE=dev\|release` | The real WebView runs the app twice: secure context, service worker, storage persistence |
| `make release-gate` | 27 platform, profile and scope reports exist and match the current source; only the folder-loopback scope has a runner so far |
| `make example-static`, `make example-url` | Run the examples; generated files go to ignored `tmp/examples/` |

The engineering gate is the defuss-vae plugin installed in the agent harness, not a copy in this
repository. Its gate (`vae.py gate --repo .`) checks the changed files against `.agents/VERIFY.py` and
runs `make lint`, `make test`, `make coverage` and `make e2e`; its skills run only when a person invokes
them.

Start reading at [ARCH.md](ARCH.md); [docs/NATIVE_GATES.md](docs/NATIVE_GATES.md) lists the open native
work.

## License

MIT, see [LICENSE](LICENSE).
