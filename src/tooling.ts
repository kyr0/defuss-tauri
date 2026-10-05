/** VERIFIED: the only module that spawns processes (enforced by tools/policy.py): native build and device tools
 * (cargo, rustc, rustup, the Tauri CLI, xcodebuild, java, adb), never the target service (tests/e2e.test.mjs). */
import { spawn, spawnSync } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { loopback } from "./target.ts";
import { TAURI_CLI_VERSION } from "./templates.ts";
import type { MobilePlatform, PreparedTauriProject, ResolvedConfig } from "./types.ts";
export function toolVersion(command: string, args = ["--version"], env: NodeJS.ProcessEnv = process.env): string | null {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 10000, windowsHide: true, env });
  return !result.error && result.status === 0 ? result.stdout.trim() : null;
}
export function assertPlatform(config: ResolvedConfig): void {
  const host = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : process.platform === "linux" ? "linux" : "unsupported";
  if (host === "unsupported") throw new Error(`Native bundling must run on its target OS; current platform is ${host}`);
  if (config.mobile === "ios" && host !== "macos") throw new Error("iOS builds require macOS with Xcode");
  if (!config.mobile && config.platform !== "native" && config.platform !== host) throw new Error(`Native bundling must run on its target OS; current platform is ${host}`);
  if (config.rustTarget && ((host === "macos" && !config.rustTarget.includes("apple-darwin")) || (host === "windows" && !config.rustTarget.includes("windows")) || (host === "linux" && !config.rustTarget.includes("linux")))) throw new Error("Rust target and build-host operating system disagree");
}
export async function runTool(command: string, args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...extraEnv }, stdio: "inherit", shell: false });
    child.once("error", reject);
    child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`Native tool failed: ${command} (exit=${code}, signal=${signal})`)));
  });
}
const isDirectory = (path: string | undefined): Promise<boolean> => path ? stat(path).then(info => info.isDirectory(), () => false) : Promise.resolve(false);
async function onPath(command: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  for (const dir of (env.PATH ?? "").split(delimiter)) {
    if (dir && await access(join(dir, command), constants.X_OK).then(() => true, () => false)) return true;
  }
  return false;
}
// Exactly what `tauri <platform> init|dev` would otherwise install via rustup/brew; checking all of it keeps Tauri from installing anything.
const MOBILE_TARGETS: Record<MobilePlatform, string[]> = {
  ios: ["aarch64-apple-ios", "x86_64-apple-ios", "aarch64-apple-ios-sim"],
  android: ["aarch64-linux-android", "armv7-linux-androideabi", "i686-linux-android", "x86_64-linux-android"],
};
const IOS_TOOLS: Array<[binary: string, brewPackage: string]> = [["xcodegen", "xcodegen"], ["pod", "cocoapods"], ["idevicesyslog", "libimobiledevice"]];
/** Missing mobile prerequisites as actionable lines; empty means ready. defuss-tauri never installs SDKs or Rust targets. */
export async function mobileProblems(platform: MobilePlatform, env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const problems: string[] = [];
  const installed = toolVersion("rustup", ["target", "list", "--installed"], env);
  if (installed === null) problems.push("rustup is required to check mobile Rust targets");
  else {
    const missing = MOBILE_TARGETS[platform].filter(target => !installed.split(/\s+/u).includes(target));
    if (missing.length) problems.push(`Missing Rust targets: rustup target add ${missing.join(" ")}`);
  }
  if (platform === "ios") {
    if (toolVersion("xcodebuild", ["-version"], env) === null) problems.push("Xcode is required (xcodebuild)");
    const absent: string[] = [];
    for (const [binary, brewPackage] of IOS_TOOLS) if (!(await onPath(binary, env))) absent.push(brewPackage);
    if (absent.length) problems.push(`Missing iOS project tools: brew install ${absent.join(" ")}`);
  } else {
    if (!(await isDirectory(env.ANDROID_HOME ?? env.ANDROID_SDK_ROOT))) problems.push("Set ANDROID_HOME to an installed Android SDK");
    if (!(await isDirectory(env.NDK_HOME))) problems.push("Set NDK_HOME to an installed Android NDK");
    if (toolVersion("java", ["-version"], env) === null) problems.push("A Java JDK is required (java on PATH)");
  }
  return problems;
}
// Permissive Android defaults: plain HTTP (127.0.0.1 transport, http:// dev servers), user-installed CAs (e.g. a
// mkcert root installed on the device) and, after the normal OS prompt, camera/microphone/location, which wry
// grants to web content once the manifest declares them. A network security config overrides the template's
// usesCleartextTraffic on Tauri's minimum SDK 24.
const ANDROID_NETWORK_CONFIG = `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="true">
        <trust-anchors>
            <certificates src="system" />
            <certificates src="user" />
        </trust-anchors>
    </base-config>
</network-security-config>
`;
const ANDROID_PERMISSIONS = ["CAMERA", "RECORD_AUDIO", "MODIFY_AUDIO_SETTINGS", "ACCESS_FINE_LOCATION", "ACCESS_COARSE_LOCATION"];
// Declared optional so stores do not hide the app on devices without this hardware.
const ANDROID_FEATURES = ["android.hardware.camera", "android.hardware.microphone", "android.hardware.location.gps"];
const INTERNET = '<uses-permission android:name="android.permission.INTERNET" />';
const CLEARTEXT_ATTRIBUTE = 'android:usesCleartextTraffic="${usesCleartextTraffic}"';
/** Applies the permissive defaults to a project created in this run; existing projects are never edited. */
export async function configureAndroidProject(project: string, fresh: boolean): Promise<void> {
  if (!fresh) return;
  const main = join(project, "app", "src", "main");
  const manifestPath = join(main, "AndroidManifest.xml");
  const manifest = await readFile(manifestPath, "utf8");
  if (!manifest.includes(INTERNET) || !manifest.includes(CLEARTEXT_ATTRIBUTE)) throw new Error(`Unexpected Tauri Android template; cannot apply permissive defaults to ${manifestPath}`);
  const declarations = [
    ...ANDROID_PERMISSIONS.map(name => `    <uses-permission android:name="android.permission.${name}" />`),
    ...ANDROID_FEATURES.map(name => `    <uses-feature android:name="${name}" android:required="false" />`),
  ].join("\n");
  await mkdir(join(main, "res", "xml"), { recursive: true });
  await writeFile(join(main, "res", "xml", "network_security_config.xml"), ANDROID_NETWORK_CONFIG, { flag: "wx" });
  await writeFile(manifestPath, manifest.replace(INTERNET, `${INTERNET}\n${declarations}`)
    .replace(CLEARTEXT_ATTRIBUTE, `${CLEARTEXT_ATTRIBUTE}\n        android:networkSecurityConfig="@xml/network_security_config"`));
}
export async function runNative(prepared: PreparedTauriProject): Promise<void> {
  const config = prepared.config;
  assertPlatform(config);
  if (!toolVersion("cargo") || !toolVersion("rustc")) throw new Error("Rust toolchain missing. Install Rust and the Tauri prerequisites, or use --prepare-only.");
  if (config.mobile) {
    const problems = await mobileProblems(config.mobile);
    if (problems.length) throw new Error(`${config.mobile} prerequisites missing (defuss-tauri never installs SDKs or Rust targets):\n- ${problems.join("\n- ")}`);
  }
  const root = join(config.managedDir, "tooling", `tauri-cli-${TAURI_CLI_VERSION}`);
  const binary = join(root, "bin", process.platform === "win32" ? "cargo-tauri.exe" : "cargo-tauri");
  try { await access(binary); }
  catch {
    if (config.skipInstall) throw new Error(`Managed Tauri CLI missing; rerun without --skip-install (build tooling only): ${binary}`);
    await runTool("cargo", ["install", "tauri-cli", "--version", TAURI_CLI_VERSION, "--locked", "--root", root], config.managedDir);
  }
  const version = toolVersion(binary);
  if (!version?.includes(TAURI_CLI_VERSION)) throw new Error(`Managed Tauri CLI version mismatch: ${version}`);
  const env = { CARGO_TARGET_DIR: config.distributionDir };
  if (config.mobile) {
    const project = join(prepared.srcTauriDir, "gen", config.mobile === "ios" ? "apple" : "android");
    const fresh = !(await isDirectory(project));
    // init creates the directory before xcodegen/pod install/Gradle steps; a half-built project would otherwise
    // pass as existing on the next run and skip init and the Android defaults. Only this run's directory is removed.
    if (fresh) {
      try { await runTool(binary, ["tauri", config.mobile, "init", "--ci", "--skip-targets-install"], prepared.srcTauriDir, env); }
      catch (error) { await rm(project, { recursive: true, force: true }); throw error; }
    }
    if (config.mobile === "android") {
      await configureAndroidProject(project, fresh);
      const target = config.target;
      // The URL stays exact: forward the device's loopback port to this machine instead of rewriting the origin.
      if (target.kind === "url" && config.command === "dev" && loopback(new URL(target.url).hostname)) {
        const url = new URL(target.url);
        const port = url.port || (url.protocol === "https:" ? "443" : "80");
        const adb = join(process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? "", "platform-tools", process.platform === "win32" ? "adb.exe" : "adb");
        try { await runTool(adb, ["reverse", `tcp:${port}`, `tcp:${port}`], prepared.srcTauriDir); }
        catch (error) { throw new Error(`adb reverse tcp:${port} failed (${error instanceof Error ? error.message : String(error)}). Start an emulator or connect a device first; set ANDROID_SERIAL if several are attached.`); }
      }
    }
  }
  const args = ["tauri", ...(config.mobile ? [config.mobile] : []), config.command === "build" ? "build" : "dev"];
  if (config.rustTarget) args.push("--target", config.rustTarget);
  if (config.debug) args.push("--verbose");
  await runTool(binary, args, prepared.srcTauriDir, env);
}
