/** Structured generation: user values are JSON data, not Rust/TOML interpolation. */
import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import type { AssetManifest, ResolvedConfig } from "./types.ts";
export const TAURI_VERSION = "2.12.1";
export const TAURI_BUILD_VERSION = "2.7.1";
export const TAURI_CLI_VERSION = "2.12.1";
const TEMPLATE_ROOT = fileURLToPath(new URL("../rust_templates/", import.meta.url));
const json = (value: unknown): Buffer => Buffer.from(JSON.stringify(value, null, 2) + "\n");
/** Desktop dev serves the live folder; release and every mobile build embed a snapshot (a phone cannot read this disk). */
export const embedsAssets = (config: ResolvedConfig): boolean => config.profile === "release" || config.mobile !== null;
// Permissive Apple defaults, merged into the iOS project (Info.ios.plist) and the macOS bundle (Info.plist):
// ATS exceptions for http:// URLs and the 127.0.0.1 transport, plus usage descriptions without which
// WebKit's camera/microphone/location access crashes or fails; the user still sees the OS prompt.
const USAGE: Array<[key: string, text: string]> = [
  ["NSCameraUsageDescription", "Web content in this app can use the camera."],
  ["NSMicrophoneUsageDescription", "Web content in this app can use the microphone."],
  ["NSLocationWhenInUseUsageDescription", "Web content in this app can use your location."],
  ["NSLocalNetworkUsageDescription", "This app can load content from development servers on your local network."],
  ["NSPhotoLibraryUsageDescription", "Web content in this app can let you choose photos."],
];
const APPLE_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>NSAppTransportSecurity</key><dict><key>NSAllowsArbitraryLoadsInWebContent</key><true/><key>NSAllowsLocalNetworking</key><true/></dict>${USAGE.map(([key, text]) => `<key>${key}</key><string>${text}</string>`).join("")}</dict></plist>\n`;
export async function renderHost(config: ResolvedConfig, manifest: AssetManifest, assets: Map<string, Buffer>): Promise<Map<string, Buffer>> {
  const files = new Map<string, Buffer>();
  async function templates(root: string, prefix: string): Promise<void> {
    for (const item of await readdir(root, { withFileTypes: true })) {
      if (["target", "Cargo.lock"].includes(item.name)) continue;
      const dest = `${prefix}/${item.name}`;
      if (item.isDirectory()) await templates(join(root, item.name), dest);
      else if (item.isFile()) files.set(dest, await readFile(join(root, item.name)));
      else throw new Error(`Unexpected template symlink/special file: ${item.name}`);
    }
  }
  await templates(TEMPLATE_ROOT, "src-tauri");
  const cargo = files.get("src-tauri/Cargo.toml");
  if (!cargo) throw new Error("Native Cargo template is missing from the package");
  files.set("src-tauri/Cargo.toml", Buffer.from(cargo.toString().replace('version = "0.1.0"', `version = ${JSON.stringify(config.version)}`).replace('default = ["static-assets"]', config.target.kind === "directory" ? 'default = ["static-assets"]' : 'default = []')));
  const profileId = config.profile === "release" ? config.identifier : `${config.identifier}.dev`;
  const store = Array.from(createHash("sha256").update(profileId).digest().subarray(0, 16));
  const embed = embedsAssets(config);
  const runtime = {
    schema: 1, target: config.target.kind === "url" ? config.target : {
      kind: "directory", root: embed ? null : config.target.root, entry: config.target.entry,
    },
    profile: config.profile, profileId, store, security: config.security, window: config.window,
    assets: { port: config.assets.port, spa: config.assets.spa, headers: config.assets.headers }, manifest,
  };
  files.set("src-tauri/runtime.json", json(runtime));
  files.set("src-tauri/asset-manifest.json", json(embed ? manifest : { schema: 1, files: [], totalBytes: 0 }));
  if (embed) for (const [name, bytes] of assets) files.set(`src-tauri/assets/${name}`, bytes);
  files.set("bootstrap/index.html", Buffer.from('<!doctype html><meta charset="utf-8"><title>defuss-tauri</title><p>The native host opens the configured target.</p>\n'));
  // Opt-in user Rust extensions: renamed path dependencies plus generated wiring and capability files.
  const extensions = config.rust.extensions;
  // Tauri resolves app.security.capabilities entries as capability identifiers; the JSON files
  // themselves are auto-discovered from src-tauri/capabilities/ (verified by cargo check).
  const capabilityIds: string[] = [];
  if (extensions.length) {
    const cargo = files.get("src-tauri/Cargo.toml")?.toString();
    if (cargo === undefined || !cargo.includes("\n[features]")) throw new Error("Native Cargo template lost its features section");
    const hostRoot = join(config.managedDir, config.mobile ? `${config.mobile}-${config.profile}` : config.profile, "src-tauri");
    const dependencies = extensions.map((ext, index) => {
      const path = relative(hostRoot, ext.path).split(sep).join("/");
      return `defuss_tauri_ext_${index} = { path = ${JSON.stringify(path)}, package = ${JSON.stringify(ext.package)} }`;
    }).join("\n");
    files.set("src-tauri/Cargo.toml", Buffer.from(cargo.replace("\n[features]", `\n# User Rust extensions, generated from rust.extensions; crate directories are validated, their contents are not parsed.\n${dependencies}\n\n[features]`)));
    const calls = extensions.map((_, index) => `    let builder = defuss_tauri_ext_${index}::defuss_tauri_extend(builder);`).join("\n");
    files.set("src-tauri/src/extensions.rs", Buffer.from(
      `//! Generated by defuss-tauri from rust.extensions; manual edits are refused on the next run.\n` +
      `//! Contract: every extension crate exposes\n` +
      `//! pub fn defuss_tauri_extend(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry>\n` +
      `pub fn wire(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {\n${calls}\n    builder\n}\n`,
    ));
    for (const [index, ext] of extensions.entries()) for (const [capabilityIndex, capability] of ext.capabilities.entries()) {
      files.set(`src-tauri/capabilities/ext-${index}-${capabilityIndex}.json`, json(capability));
      capabilityIds.push(String(capability.identifier));
    }
  }
  // Custom app icons: copied in as hash-owned host files; the source files stay where the user keeps them.
  const iconFiles: string[] = [];
  for (const icon of config.icons) {
    const name = `icons/${basename(icon)}`;
    files.set(`src-tauri/${name}`, await readFile(icon));
    iconFiles.push(name);
  }
  files.set("src-tauri/tauri.conf.json", json({
    $schema: "https://schema.tauri.app/config/2", productName: config.appName,
    identifier: profileId, version: config.version,
    build: { frontendDist: "../bootstrap" },
    app: { windows: [], withGlobalTauri: false, security: { csp: null, capabilities: capabilityIds } },
    bundle: { active: true, targets: "all", icon: iconFiles.length ? iconFiles : ["icons/icon.png", "icons/icon.ico", "icons/icon.icns"], macOS: { minimumSystemVersion: "14.0", infoPlist: "Info.plist" }, iOS: { minimumSystemVersion: "17.0" } },
  }));
  files.set("src-tauri/Info.plist", Buffer.from(APPLE_PLIST));
  files.set("src-tauri/Info.ios.plist", Buffer.from(APPLE_PLIST));
  files.set("README.md", Buffer.from("Generated host. Do not edit hashed files; changes are preserved by refusing regeneration. Cargo.lock is retained. Build outputs live outside this directory. See the package migration guide.\n"));
  // Refuse an incorrectly installed package before writing anything.
  if (!files.has("src-tauri/src/main.rs")) throw new Error(`Incomplete templates near ${dirname(TEMPLATE_ROOT)}`);
  return files;
}
