//! Native shell only. Target services have no child-process or lifecycle representation.
//! Desktop enters through main.rs; iOS/Android through the mobile entry point.
mod extensions;
mod profile;
#[cfg(feature = "probe")]
use std::fs;
use serde::Deserialize;
use std::{error::Error, io, path::PathBuf};
#[cfg(feature = "static-assets")]
use std::collections::BTreeMap;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
#[cfg(desktop)]
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
#[cfg(feature = "static-assets")]
use defuss_tauri_transport::{AssetSource, ServerOptions, Transport};
#[cfg(feature = "static-assets")]
include!(concat!(env!("OUT_DIR"), "/embedded.rs"));

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum Target { Url { url: String }, Directory { root: Option<PathBuf>, entry: String } }
// Window geometry and menus exist only on desktop; mobile webviews fill the screen.
#[cfg(desktop)]
#[derive(Deserialize)]
struct Window { title: String, width: f64, height: f64, resizable: bool, fullscreen: bool }
// Static-asset settings exist only in hosts that serve a directory; serde ignores them otherwise.
#[cfg(feature = "static-assets")]
#[derive(Deserialize)]
struct Assets { port: Option<u16>, spa: bool, headers: BTreeMap<String, String> }
#[cfg(feature = "static-assets")]
#[derive(Deserialize)]
struct ManifestFile { path: String }
#[cfg(feature = "static-assets")]
#[derive(Deserialize)]
struct Manifest { files: Vec<ManifestFile> }
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    schema: u32, target: Target, security: String, store: [u8; 16],
    #[cfg(desktop)] window: Window,
    #[cfg(feature = "static-assets")] assets: Assets,
    #[cfg(feature = "static-assets")] manifest: Manifest,
}
fn failure(message: &str) -> io::Error { io::Error::other(message) }
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if let Err(error) = start() { eprintln!("defuss-tauri: {error}"); std::process::exit(1); }
}
fn start() -> Result<(), Box<dyn Error>> {
    let config: Config = serde_json::from_str(include_str!("../runtime.json"))?;
    if config.schema != 1 { return Err(failure("Unsupported runtime config schema").into()); }
    // User extensions wrap the pristine builder first; defuss-tauri layers window, menu and store setup after.
    extensions::wire(tauri::Builder::default()).setup(move |app| {
        let directory = app.path().app_data_dir()?.join("profile-v1");
        let profile = profile::Profile::open(&directory)?;
        let target_url = match &config.target {
            Target::Url { url } => url.parse::<tauri::Url>()?,
            Target::Directory { root, entry } => {
                #[cfg(feature = "static-assets")]
                {
                    let source = match root {
                        Some(root) => AssetSource::disk(root, config.manifest.files.iter().map(|item| item.path.clone()))?,
                        None => AssetSource::embedded(EMBEDDED)?,
                    };
                    let transport = Transport::start(source, ServerOptions { entry: entry.clone(), spa: config.assets.spa, headers: config.assets.headers.clone() }, &directory, config.assets.port)?;
                    let mut url = tauri::Url::parse(&transport.origin())?;
                    { let mut segments = url.path_segments_mut().map_err(|_| failure("Invalid static origin"))?; segments.clear(); for segment in entry.split('/') { segments.push(segment); } }
                    app.manage(transport);
                    url
                }
                #[cfg(not(feature = "static-assets"))]
                { let _ = (root, entry); return Err(failure("Host was built without static-assets support").into()); }
            }
        };
        if !matches!(target_url.scheme(), "http" | "https") { return Err(failure("Target is not HTTP(S)").into()); }
        #[cfg(desktop)]
        let retry_url = target_url.clone();
        // Shadowing (no `mut`): Android applies none of the platform-specific steps below.
        let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::External(target_url))
            .devtools(config.security == "developer");
        #[cfg(desktop)]
        let builder = {
            let retry = MenuItem::with_id(app, "reload-target", "Reload configured target", true, Some("CmdOrCtrl+R"))?;
            let quit = PredefinedMenuItem::quit(app, None)?;
            let submenu = Submenu::with_items(app, "Application", true, &[&retry, &quit])?;
            let menu = Menu::with_items(app, &[&submenu])?;
            builder.title(&config.window.title).inner_size(config.window.width, config.window.height)
                .resizable(config.window.resizable).fullscreen(config.window.fullscreen).menu(menu)
                .on_menu_event(move |window, event| { if event.id().as_ref() == "reload-target" {
                    if let Some(webview) = window.get_webview_window("main") { let _ = webview.navigate(retry_url.clone()); }
                }})
        };
        // WKWebView isolates by store identifier (macOS 14+/iOS 17+); WebView2/WebKitGTK by data directory.
        // Android's WebView profile is already per-app and persistent.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        let builder = builder.data_store_identifier(config.store);
        #[cfg(any(windows, target_os = "linux"))]
        let builder = { let _ = config.store; builder.data_directory(directory.join("webview")) };
        #[cfg(target_os = "android")]
        let _ = config.store;
        // Only probe-feature binaries expose a report channel. It cannot grant native commands.
        #[cfg(feature = "probe")]
        let builder = if let (Ok(output), Ok(run_id)) = (std::env::var("DEFUSS_TAURI_PROBE_OUTPUT"), std::env::var("DEFUSS_TAURI_PROBE_RUN_ID")) {
            let handle = app.handle().clone();
            let injection = format!("Object.defineProperty(window, '__DEFUSS_PROBE_RUN_ID', {{value: {}}});", serde_json::to_string(&run_id)?);
            builder.initialization_script(&injection).on_navigation(move |url| {
                if url.scheme() != "defuss-probe" { return true; }
                if let Some((_, raw)) = url.query_pairs().find(|(key, _)| key == "report") {
                    if let Ok(report) = serde_json::from_str::<serde_json::Value>(&raw) {
                        if report["runId"].as_str() == Some(run_id.as_str()) {
                            let ok = report["status"] == "VERIFIED";
                            match fs::write(&output, serde_json::to_vec_pretty(&report).unwrap_or_default()) {
                                Ok(()) => handle.exit(if ok { 0 } else { 2 }),
                                Err(error) => { eprintln!("Probe evidence write failed: {error}"); handle.exit(3); }
                            }
                        }
                    }
                }
                false
            })
        } else { builder };
        builder.build()?;
        app.manage(profile);
        Ok(())
    }).run(tauri::generate_context!())?;
    Ok(())
}
