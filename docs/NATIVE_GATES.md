# Native gates and remaining implementation work

Status on 2026-10-06: **not certified on any platform**. On macOS 15.7 (arm64, rustc 1.96)
`make native-test`, `make mobile-check` and `make native-probe` pass: the real WKWebView got a secure
context on `http://127.0.0.1`, a service worker that activates, controls the page and intercepts fetches,
and localStorage, CacheStorage and IndexedDB that survive a restart on the same origin. Only the
folder-loopback scope has run, and only on macOS; Windows, Linux, iOS and Android have not run the host. Run the supplied tests before treating the host as usable on a given OS.
VAE fast verification cannot waive this document's native requirements.

## Implemented runner

`make native-test` runs Rust tests using actual loopback sockets. It covers MIME/HEAD/ranges, navigation-only
SPA fallback, missing workers, Host validation, traversal/symlinks, live manifest-limited files, persistent
port reuse and occupied-port refusal. It does not require a WebView but does require Cargo/dependencies.

`make native-probe PROFILE=dev` and `PROFILE=release` generate a host from the actual package, compile it
with the probe-only report feature, execute the binary twice and read results from the actual WebView.
An isolated random application identifier prevents pollution of normal app profiles. It checks secure
context, worker API/registration/activation/client control/interception, missing-worker 404, storage
writes and restart persistence of origin, localStorage, CacheStorage and IndexedDB. It records browser
user agent, OS, Rust, binary SHA-256/size, Cargo-lock digest and the complete current-input fingerprint.

The runner leaves its isolated app-data profile for inspection. It does not clear user storage. Temporary
source/build/evidence directories are ignored. A worker that cannot activate makes the real probe fail;
there is no fallback to a different browser or a fabricated API. GUI runner availability is itself a
prerequisite, not an excuse to mark a platform verified.

## Release matrix

`make release-gate` checks 27 reports in output/native:

- Each of Linux/macOS/Windows × dev/release: folder-loopback-lifecycle, url-lifecycle,
  https-self-signed-lifecycle, worker-upgrade (24 reports).
- Each platform's release profile: distribution (3 reports).

File format and exact required check names are executable in `tools/release_gate.py`. The built-in
runner produces **only folder-loopback-lifecycle**. The remaining scopes are intentionally absent,
not empty pass templates. Their validators are implemented and tested using synthetic test inputs;
those synthetic inputs are never stored as actual release evidence. Validation catches missing, stale
and incomplete reports; it cannot prove that an editable report was not fabricated, so retained logs,
independent review and trusted CI remain necessary.

## Causal next steps

### 1. Compile and validate the existing host

macOS desktop compilation is done (see Status). Run native-test, then the dev/release folder probes on
each real OS. Fix compile/runtime failures at
the lowest failing layer: Rust transport before WebView behavior. Retain the first successful Cargo
locks and exact native environment. Inspect application lifetime, WebView data-store isolation, port
conflicts and same-profile second launch. Do not infer platform support merely from official API docs.

### 2. URL runtime lifecycle

Build with the test service stopped. Launch against a separately owned service, check exact origin,
authentication, reload/recovery and WebSocket behavior. Close/force-terminate the native app and assert
the external service survives. The test harness, not defuss-tauri, owns that fixture service. Existing
JavaScript e2e establishes only preparation behavior and CLI exit, not native close/crash behavior.

### 3. Self-signed HTTPS: the CA-install model (decided 2026-10-09)

The app adds no TLS exception handlers and modifies no trust store. Self-signed dev servers are
supported through a CA the developer installs on the OS or device, produced by any standard issuer:
smallstep (`step certificate create` or a local `step-ca`), Caddy with an external certificate
(`tls <cert> <key>`), or `mkcert`. Caddy's internal CA (`tls internal`) additionally installs its root
into the system trust store itself (`caddy trust`) — a developer-machine convenience the app neither
performs nor requires.

Why no app-scoped handlers: VERIFIED (2026-10-09, source inspection of the compiled dependency graph)
that wry 0.57.0 and tauri 2.12.1 / tauri-runtime-wry expose no certificate-verification hook on any
platform — WebView2's `ServerCertificateErrorDetected`, WebKitGTK's `allow_tls_certificate_for_host`
and Android's `onReceivedSslError` are all unwired — so handlers would require a wry fork or an
upstream API first. WKWebView offers no public app-scoped server-trust exception at all, so macOS and
iOS could never share that model; the platform's own trust path is the one mechanism that is uniform,
reviewable and already documented per device. An insecure-page flag, CSP header or successful first
navigation is not proof of worker TLS handling either way.

The `https-self-signed-lifecycle` release scope keeps its claim set and means: the full lifecycle —
main navigation, subresources, worker script fetching, activation/control, update, restart and WSS
separately — over a server whose CA was installed through the platform's normal trust path before the
run. Its `exception_scope` claim reports that no in-app exception exists (`platform trust via
installed CA only`), and `os_trust_store_unchanged` proves the app changed no store during its
lifecycle.

A Rust loopback origin bridge remains ruled out as before: an explicit alternative only after native
evidence shows it is needed, never a hidden universal fallback. It changes origin and needs
independently specified redirects/cookies/authentication/CSP/WSS semantics. If an engine itself lacks
required worker support, changing TLS transport is not a solution.

### 4. Upgrade and distribution

Install old build with active worker and persisted data, build/install updated assets, and verify the
new worker controls fetches without erasing storage. A simple second launch of identical assets does
not constitute an upgrade test.

Measure actual binary, resources, installed bundle, installer and build-cache sizes separately. Inspect
packaged runtime contents for unintended Node/Bun/npm/dependencies and duplicate selected assets. Launch
on a clean machine without a JS runtime. Validate signatures after bundling; no post-sign modification.
The existing package-payload check measures the npm development package, not an installed native app.

### 5. Mobile (iOS / Android): compile-verified only

`make mobile-check` proves only that the generated host type-checks for `aarch64-apple-ios-sim` and
`aarch64-linux-android` (folder, URL and probe feature sets, `-D warnings`). Neither `tauri ios|android
init` nor a simulator, emulator or device run has happened; `release-gate` has no mobile rows. Before
claiming support, on each platform: init from a clean host and confirm `gen/` is the only tool-written
path; run folder dev/release and check the 127.0.0.1 origin persists across restarts (and that Android
release loads it through the network security config). Check a LAN URL and a loopback URL via the iOS
Simulator and via `adb reverse`. Confirm the permissive defaults on device: getUserMedia and geolocation
prompts then work, and an HTTPS dev server with an mkcert CA installed on the device loads. A
self-signed certificate without an installed CA must still be rejected. Run the existing worker/storage probe in the mobile WebView: WKWebView on iOS, the
system WebView on Android. Port the probe report channel to mobile only with that evidence.

## Known scaffold choices, not accidental omissions

All symlinks are rejected. Existing manifest-listed dev files are live; new files need a dev restart.
Second-instance focus forwarding, multi-root asset mounts, hot-reload injection, OS permission adapters
and a dedicated native offline status surface are not implemented. Native commands are not built in:
the opt-in `rust.extensions` mechanism compiles user-owned crates into the host instead (see the
README), and the default host still ships none. Standard
engine errors plus a native reload menu are provided. macOS 14 is the explicit minimum for per-app
persistent data stores. Developer mode enables inspector functionality; upstream documents private
macOS APIs for that feature, so App Store suitability is not assumed.

HTTP listener requests validate Host but are not authenticated against other local programs. Serving
selected static bytes is intentional; never include secrets. Advisory profile locking coordinates
cooperating app processes, not hostile users. Evidence validators establish schema/content freshness,
not cryptographic authenticity of human/model observations. Review remains required.
