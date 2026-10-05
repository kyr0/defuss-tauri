/** JSON-only configuration; explicit values win without executable discovery. */
import { readFile, lstat, realpath } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { hasControlCharacter, inside, loopback, relativeAssetPath, resolveTarget } from "./target.ts";
import type { DefussTauriConfig, DefussTauriOptions, DefussTauriPlatform, MobilePlatform, ResolvedConfig } from "./types.ts";

const KEYS = new Set(["$schema", "target", "entry", "appName", "identifier", "version", "platform", "rustTarget", "managedDirName", "tauriOutDir", "security", "window", "assets"]);
function object(value: unknown, at: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${at} must be an object`);
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: Set<string>, at: string): void {
  for (const key of Object.keys(value)) if (!allowed.has(key)) throw new Error(`Unknown ${at} field: ${key}`);
}
function text(value: unknown, at: string): void {
  if (typeof value !== "string" || !value.trim() || hasControlCharacter(value)) throw new Error(`${at} must be a nonempty string without control characters`);
}
function bool(value: unknown, at: string): void { if (typeof value !== "boolean") throw new Error(`${at} must be boolean`); }
function integer(value: unknown, min: number, max: number, at: string): void {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) throw new Error(`${at} must be an integer in ${min}..${max}`);
}
export function validateConfig(input: unknown): DefussTauriConfig {
  const obj = object(input, "config"); keys(obj, KEYS, "config");
  for (const key of ["$schema", "target", "entry", "appName", "identifier", "version", "rustTarget", "managedDirName", "tauriOutDir"])
    if (obj[key] !== undefined) text(obj[key], key);
  if (obj.appName !== undefined && /[\\/:*?"<>|]/u.test(String(obj.appName))) throw new Error("appName contains a platform filename character; use window.title for arbitrary display text");
  if (obj.platform !== undefined && !["native", "macos", "linux", "windows", "ios", "android"].includes(String(obj.platform))) throw new Error("Invalid platform");
  if (obj.security !== undefined && !["developer", "strict"].includes(String(obj.security))) throw new Error("Invalid security profile");
  if (obj.identifier !== undefined && !/^[a-zA-Z][a-zA-Z\d-]*(\.[a-zA-Z][a-zA-Z\d-]*)+$/u.test(String(obj.identifier))) throw new Error("identifier must be a reverse-DNS identifier");
  if (obj.version !== undefined && !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(String(obj.version))) throw new Error("version must be a three-part semantic version");
  if (obj.rustTarget !== undefined && !/^[a-zA-Z\d_]+(?:-[a-zA-Z\d_]+){2,}$/u.test(String(obj.rustTarget))) throw new Error("rustTarget must be a Rust compilation triple");
  if (obj.entry !== undefined) relativeAssetPath(String(obj.entry), "entry");
  if (obj.window !== undefined) {
    const window = object(obj.window, "window");
    keys(window, new Set(["title", "width", "height", "resizable", "fullscreen"]), "window");
    if (window.title !== undefined) text(window.title, "window.title");
    for (const key of ["width", "height"]) if (window[key] !== undefined) integer(window[key], 1, 32768, `window.${key}`);
    for (const key of ["resizable", "fullscreen"]) if (window[key] !== undefined) bool(window[key], `window.${key}`);
  }
  if (obj.assets !== undefined) {
    const assets = object(obj.assets, "assets");
    keys(assets, new Set(["port", "spa", "include", "exclude", "headers"]), "assets");
    if (assets.port !== undefined) integer(assets.port, 1, 65535, "assets.port");
    if (assets.spa !== undefined) bool(assets.spa, "assets.spa");
    for (const key of ["include", "exclude"]) if (assets[key] !== undefined) {
      if (!Array.isArray(assets[key])) throw new Error(`assets.${key} must be an array`);
      for (const path of assets[key]) { text(path, `assets.${key}`); relativeAssetPath(String(path), `assets.${key}`); }
    }
    if (assets.headers !== undefined) for (const [key, value] of Object.entries(object(assets.headers, "assets.headers"))) {
      if (!/^[!#$%&'*+.^_`|~\da-z-]+$/iu.test(key) || typeof value !== "string" || /[^\x20-\x7e\t]/u.test(value)) throw new Error("Invalid HTTP header name/value");
      if (["content-length", "transfer-encoding", "connection", "content-range", "host"].includes(key.toLowerCase())) throw new Error(`Transport owns header ${key}`);
    }
  }
  return obj as DefussTauriConfig;
}
async function canonicalFuture(path: string): Promise<string> {
  try { return await realpath(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) return path;
    return join(await canonicalFuture(parent), basename(path));
  }
}
export const mobilePlatform = (platform: DefussTauriPlatform): MobilePlatform | null => platform === "ios" || platform === "android" ? platform : null;
export async function readConfig(options: DefussTauriOptions): Promise<{ file: string | null; data: DefussTauriConfig; cwd: string }> {
  const cwd = await realpath(resolve(options.projectDir ?? "."));
  const file = resolve(cwd, options.config ?? "defuss-tauri.json");
  let source: string;
  try { source = await readFile(file, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT" && options.config === undefined) return { file: null, data: {}, cwd };
    throw error;
  }
  let data: unknown;
  try { data = JSON.parse(source); } catch { throw new Error(`Invalid JSON in ${file}`); }
  return { file, data: validateConfig(data), cwd };
}
export async function resolveConfig(options: DefussTauriOptions = {}): Promise<ResolvedConfig> {
  const { file, data, cwd } = await readConfig(options);
  const explicit = Object.fromEntries(Object.entries(options).filter(([key, value]) => KEYS.has(key) && value !== undefined));
  const merged = validateConfig({ ...data, ...explicit, window: { ...data.window, ...options.window }, assets: { ...data.assets, ...options.assets } });
  const base = file ? dirname(file) : cwd;
  const targetBase = options.target !== undefined ? cwd : base;
  const target = await resolveTarget(merged.target ?? cwd, targetBase, merged.entry);
  if (target.kind === "url" && Object.keys(merged.assets ?? {}).length) throw new Error("assets settings apply only to a directory; URL host and port are never rewritten");
  const pathOption = async (name: "managedDirName" | "tauriOutDir", fallback: string) =>
    canonicalFuture(resolve(options[name] !== undefined ? cwd : base, merged[name] ?? fallback));
  const command = options.command ?? "dev";
  const profile = command === "build" ? "release" : "dev";
  const managedDir = await pathOption("managedDirName", ".defuss-tauri");
  const distributionDir = await pathOption("tauriOutDir", command === "build" ? "dist-tauri-build" : "dist-tauri-dev");
  if (inside(managedDir, cwd) || inside(distributionDir, cwd) || inside(managedDir, distributionDir) || inside(distributionDir, managedDir)) {
    throw new Error("Managed/output directories must be distinct descendants or siblings, never ancestors of the invocation directory or each other");
  }
  if (target.kind === "directory" && (inside(managedDir, target.root) || inside(distributionDir, target.root))) throw new Error("Target must not be inside managed/output directories");
  for (const path of [managedDir, distributionDir]) {
    try { if ((await lstat(path)).isSymbolicLink()) throw new Error(`Generated directory cannot be a symlink: ${path}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  }
  const identity = createHash("sha256").update(target.kind === "directory" ? target.root : new URL(target.url).origin).digest("hex").slice(0, 12);
  const derivedName = target.kind === "directory" ? basename(target.root) : new URL(target.url).hostname;
  const appName = merged.appName ?? (derivedName.replace(/[\\/:*?"<>|]/gu, " ").trim() || "Defuss App");
  const warnings: string[] = [];
  if (merged.identifier === undefined) warnings.push("Set identifier before distribution; the generated identifier is location-derived.");
  const platform = merged.platform ?? "native";
  const mobile = mobilePlatform(platform);
  const identifier = merged.identifier ?? `tech.defuss.app${identity}`;
  if (mobile && merged.rustTarget !== undefined) throw new Error("rustTarget is desktop-only; Tauri selects the iOS/Android ABIs");
  // Android derives its Java package from the identifier, where hyphens are invalid.
  if (mobile === "android" && identifier.split(".").some(part => !/^[a-zA-Z][a-zA-Z\d_]*$/u.test(part))) throw new Error("Android identifier segments must be letters, digits or underscores (no hyphens)");
  if (target.kind === "url") {
    const url = new URL(target.url);
    if (url.protocol === "https:") warnings.push("HTTPS uses platform TLS validation. Self-signed certificate adapters are not implemented in this scaffold; developer is not a TLS-bypass flag.");
    else if (!loopback(url.hostname)) warnings.push("Non-loopback HTTP may not be a secure context. Native API availability is unverified.");
    // The URL stays exact; loopback means the device itself, so only reachable setups are allowed.
    if (mobile === "ios" && loopback(url.hostname)) {
      if (command === "build") throw new Error("An iOS build installs on devices, where a loopback URL is the device itself. Use a URL the device can reach, e.g. a LAN address.");
      warnings.push("A loopback URL reaches this Mac only from the iOS Simulator; a physical iPhone needs a LAN URL.");
    }
    if (mobile === "android" && loopback(url.hostname) && command === "build") warnings.push("This Android build opens a loopback URL on the device itself; adb port forwarding exists only during dev.");
  }
  return {
    command, projectDir: cwd, configFile: file, target, appName,
    identifier, version: merged.version ?? "0.1.0",
    platform, mobile, rustTarget: merged.rustTarget ?? null,
    managedDir, distributionDir, profile, security: merged.security ?? "developer",
    window: { title: merged.window?.title ?? appName, width: merged.window?.width ?? 1280, height: merged.window?.height ?? 800, resizable: merged.window?.resizable ?? true, fullscreen: merged.window?.fullscreen ?? false },
    assets: { port: merged.assets?.port ?? null, spa: merged.assets?.spa ?? false, include: (merged.assets?.include ?? []).map((path) => relativeAssetPath(path, "assets.include")), exclude: (merged.assets?.exclude ?? []).map((path) => relativeAssetPath(path, "assets.exclude")), headers: merged.assets?.headers ?? {} },
    skipInstall: options.skipInstall ?? false, debug: options.debug ?? false, dryRun: options.dryRun ?? false, prepareOnly: options.prepareOnly ?? false, warnings,
  };
}
