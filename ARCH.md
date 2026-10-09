# Architecture: defuss-tauri

defuss-tauri turns one HTTP(S) URL or one static folder into a Tauri app for macOS, Windows, Linux, iOS
or Android. The TypeScript CLI resolves configuration, selects the folder's files, generates a
hash-owned Rust host and runs a pinned Tauri CLI on it. It is deliberately not a dev server, bundler,
static-site generator, backend runtime or supervisor for the service behind a URL: the packaged app
contains no Node, Bun or npm, and the CLI never installs, starts, stops or contacts that service.

## Why this design

The package replaces `kyr0/defuss/packages/tauri`, which downloaded Node, ran an SSG and shipped a Node
sidecar inside the app. `tools/policy.py` fails `make lint` if that machinery (`prepareNodeSidecar`,
`runLocalDefussSsg`, `start_defuss_server`, a shell plugin, `std::process::Command`) reappears. The
replacement accepts what any frontend toolchain already produces, a running URL or a built folder, so
the wrapper needs no knowledge of the framework.

**URL targets are opened exactly as given.** Path, query and fragment are serialized unchanged into the
host (`tests/assets.test.mjs`, "URL-only release serializes exact endpoint"). Browser storage belongs to
an origin, so rewriting host or port would silently start the app with empty storage. A plausible
alternative, proxying the URL through a local server, was rejected for the same reason and because it
would have to reimplement redirects, cookies and WebSockets.

**Folder targets are served by an in-process HTTP listener on 127.0.0.1 with a persisted port**, not by
Tauri's custom asset protocol. The W3C Secure Contexts specification treats `http://127.0.0.1` as
potentially trustworthy, so the page can get a secure context without certificates. Tauri's protocol
gives a different origin per platform (`tauri://localhost` versus `http://tauri.localhost`). Persisting
the port keeps the origin across restarts, and browsers key localStorage, IndexedDB and CacheStorage to
the origin. The port reuse is tested in `rust_templates/transport/tests/http.rs`
(`persisted_origin_survives_restart_and_conflicts_never_fall_back`); storage persistence in the real
WebView is what `make native-probe` checks.
A port conflict fails instead of choosing a new port, because a silent new origin loses storage.

**Generated files are hash-owned instead of overwritten.** Each host records the SHA-256 of every file it
wrote. Regeneration replaces only files whose hash still matches, refuses edited, deleted or unexpected
files, and never deletes unowned data (`tests/assets.test.mjs`, "owned regeneration refuses custom
modifications"). Overwriting would destroy native customizations; deleting a legacy directory would
destroy user data.

## How it works

The CLI resolves everything before it writes, then generates the host, then hands it to Tauri:

```mermaid
flowchart TD
  A["defuss-tauri.json + CLI flags"] --> B["resolveConfig"]
  B --> C{"target kind"}
  C -->|"folder"| D["collectAssets: select + hash"]
  C -->|"URL"| E["renderHost"]
  D --> E
  E --> F["writeManaged: hash-owned host"]
  F --> G["runNative: preflight + pinned tauri-cli"]
  G --> H["generated Tauri app"]
  H -->|"URL"| I["WebView opens the exact URL"]
  H -->|"folder"| J["Transport on 127.0.0.1"]
  J --> K["WebView opens the persisted origin"]
```

| Module | Responsibility |
|---|---|
| `src/args.ts` | Parses the CLI grammar without side effects; removed Node/SSG flags fail with a migration message. |
| `src/config.ts` | Reads one JSON file (no ancestor search), merges CLI fields, validates every key, applies mobile rules. |
| `src/target.ts` | Classifies URL versus directory, rejects credentials in URLs, finds the HTML entry, checks containment. |
| `src/assets.ts` | Walks the folder, applies exclusions, rejects selected symlinks, hashes each file; release rechecks hashes before embedding. |
| `src/templates.ts` | Copies `rust_templates/` and writes runtime data as JSON (never interpolated into Rust or TOML). |
| `src/managed.ts` | Writes the host under a generation lock with per-file hash ownership. |
| `src/tooling.ts` | The only module that spawns processes: version probes, `cargo install` of the pinned Tauri CLI, mobile preflight and init, `adb reverse`, `tauri dev|build`. |
| `rust_templates/src/lib.rs` | The app: opens the target URL or starts the transport, sets per-platform storage isolation, builds the window. `main.rs` only calls it; iOS and Android load it as a library. |
| `rust_templates/src/profile.rs` | Holds an OS file lock on the app-data profile for the app's lifetime; a second instance fails. |
| `rust_templates/transport/` | The static HTTP listener (`tiny_http`): GET and HEAD, single byte ranges, MIME types, directory indexes, configured headers. |

| Target | Native behavior | Bundled payload |
|---|---|---|
| URL | The WebView navigates to the URL | Host and a one-line bootstrap page; no copy of the site |
| Folder, desktop dev | Transport reads manifest-listed files from disk on each request | No asset copy |
| Folder, release and every mobile build | Transport serves bytes embedded by `build.rs` | The selected snapshot, once |

**Transport contract.** It binds 127.0.0.1 only and hands the already-bound socket to `tiny_http`, so
there is no window between choosing and binding a port. Requests need `Host: 127.0.0.1:<port>`, otherwise
421, which blocks DNS rebinding. Only GET and HEAD are served (405 otherwise). The SPA fallback serves the
entry page only for document navigations to extensionless paths, so a missing `sw.js`, module or WASM
file stays 404. Default responses carry `content-type`, `cache-control: no-cache`, `accept-ranges` and
`x-content-type-options: nosniff`; configured headers may not set framing headers such as
`content-length`. Four worker threads serve requests; responses stream instead of buffering whole files.

**Storage isolation.** macOS and iOS use a WKWebView data store identified by 16 bytes derived from the
app identifier (macOS 14 and iOS 17 minimum). Windows and Linux use a per-profile data directory. Android
WebView data is already per app. Dev builds append `.dev` to the identifier, so dev and release never
share storage.

**Generated host layout.** Hosts live in `.defuss-tauri/<profile>/` with profile `dev`, `release`,
`ios-dev`, `ios-release`, `android-dev` or `android-release`. `src-tauri/gen/` belongs to Tauri: schemas,
and on mobile the Xcode or Gradle project from `tauri <platform> init`. It is skipped by ownership
checks, but a symlinked `gen` is rejected. `Cargo.lock` is retained between runs.

## Operations

- **Configuration and policy:** `defuss-tauri.json` keys are validated in `validateConfig`
  (`src/config.ts`) and described by `defuss-tauri.schema.json`. Precedence is CLI flags, then the JSON
  file, then defaults. Environment keys are listed in `.env.example`; only Android builds and the native
  probe read them.
- **Deployment:** the npm package ships `dist/` (pkgroll bundles of `index.js` and `cli.js`, plus
  `index.d.ts`), `rust_templates/` and the schema. The bundles resolve `rust_templates/` relative to
  `dist/`, the same depth as `src/`. Cargo output goes to
  `--tauri-out` (`dist-tauri-dev` or `dist-tauri-build`); mobile bundles stay in Tauri's `gen/` project.
  Rust build artifacts and lock files are excluded from the package, and `tools/pack_test.py` fails if
  any appear.
- **Complexity and resources:** each prepare reads and hashes every selected file; release reads them a
  second time to detect changes during the build. The transport's four workers bound concurrency, so a
  client that stalls a connection occupies one of them.
- **Third-party integrations:** `tauri` 2.12.1 and `tauri-build` 2.7.1 are exact pins, because the host
  code is written against their API. `tiny_http` 0.12, `mime_guess` 2.0.5, `percent-encoding` 2.3.1,
  `serde` 1.0.228, `serde_json` 1.0.145 and `fs2` 0.4.3 are caret minimums: exact pins conflicted with
  Tauri's own dependency graph (`url` 2.5.6 requires `percent-encoding ^2.3.2`). The first native build
  writes `Cargo.lock`, which then pins every version. The Tauri CLI 2.12.1 is installed with
  `cargo install --locked` into the managed directory. The replaced package's original files were `index.ts` (blob `e11945eb0e375662db889ec00f906fdc0e805e55`),
  `cli.ts` (`154d6f0a7e2d8906000881ced4ef072734211571`), `types.ts`
  (`213dbf36ef1266dcc8a94760093159398483a02b`) and `package.json`
  (`6963ad3cdb13a2156e74f33b2f1aea9231b31cc6`) in `kyr0/defuss/packages/tauri`. API references consulted
  on 2026-10-04: the Tauri `WebviewWindowBuilder` and configuration references, `tiny_http` 0.12.0
  `Server` and `HeaderField`, and the W3C Secure Contexts specification.
- **Reliability:** failures stop instead of degrading: an occupied port, a second instance on the same
  profile, an edited or unexpected generated file, a held generation lock, a missing mobile prerequisite.
  A crash during generation can leave `.generation-lock` or a partially written host behind; the error
  names the lock, which is removed by hand after checking that no other generator runs, and a damaged
  host is restored or replaced by a new managed directory. A failed mobile init removes the project directory it
  just created, so the next run initializes again.
- **Observability:** the CLI prints one result line plus warnings, and native tools write to the
  inherited terminal. Diagnostic output redacts URL query and fragment. There are no log files or
  metrics.

## Security and privacy

**Attack surface.** The transport does not authenticate local users: any process on the machine that
sends the right `Host` header can read the selected files. Do not put secrets in the target folder; the
default exclusions (`.env*`, `*.pem`, `*.key`, `*.p12`, `*.pfx`, SSH keys, VCS directories, dependency
trees, hidden files) prevent accidental publication, not a malicious local writer. Selected symlinks
are rejected, so a link cannot pull files from outside the folder. A file swapped between check and read
by a concurrent local writer (TOCTOU) is outside this threat model.

**Native capabilities.** The app exposes no Tauri commands (`capabilities: []`, no global Tauri object)
and has no shell plugin. The `developer` security profile, the default, enables the WebView inspector in
dev and release builds; `strict` disables it. Neither profile injects a CSP or changes CORS, secure
context or TLS behavior.

**TLS and network.** Certificate validation is the platform's: certificate errors are rejected and
there is no bypass. The generated configuration is deliberately permissive: Apple ATS allows plain HTTP
in web content and local networking. New Android projects allow cleartext to every host and trust
user-installed CAs. Trusting user CAs also trusts any CA a device administrator installs; production
builds that do not need it can remove `<certificates src="user" />` from the Android network security
config.

Self-signed dev servers ride the same platform path: a CA the developer installs on the OS or device
(`mkcert`, smallstep's `step-ca` or `step certificate create`, or Caddy with an external certificate),
never an app-side exception. Why not app-scoped handlers: the pinned wry 0.57.0 / tauri 2.12.1 surface
exposes no certificate-verification hook on any platform (verified against their sources), and
WKWebView offers no app-scoped server-trust exception at all, so the platform trust path is the one
uniform, reviewable mechanism. Caddy's internal-CA mode installs its root into the system store
itself; the app never modifies trust stores.

**Rust extensions.** The generated host stays wrapper-only by default. `rust.extensions` in the
configuration opts a project into its own native code: each entry references a user-owned library
crate by path, the generated `Cargo.toml` gains a renamed path dependency, and a generated
`extensions.rs` calls the crate's `defuss_tauri_extend(builder)` first in the Tauri builder chain.
Capability objects are rendered verbatim as data into `src-tauri/capabilities/`. Why path references
instead of copying user sources: the crate keeps one owner and one edit location, nothing unowned
enters the generated tree (the fail-closed guards stay intact), and a wrong hook signature fails the
build loudly. The mechanism is compile-verified (`make native-test` checks a fixture extension host
with `-D warnings`); runtime behavior of user extension code is the developer's scope, not a
defuss-tauri support claim.

**Inputs from outside.** URL credentials (`https://user:password@host`) are rejected. A URL's query is
compiled into the binary, so tokens in it are not secret. On iOS and Android, web content gets camera,
microphone and location only after the system's permission prompt.

**Privacy.** defuss-tauri processes no personal data itself and sends no telemetry. It reaches the
network only through the build tools it runs: `cargo install` and Cargo (crates.io), and on mobile
Gradle and CocoaPods. Data the wrapped web content stores
stays in the app's WebView profile on the device, governed by that content's own privacy terms.
