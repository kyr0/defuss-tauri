/** Public orchestrator: configuration -> selected assets -> native host -> native tooling. */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { collectAssets, readAssetSnapshot } from "./assets.ts";
import { mobilePlatform, readConfig, resolveConfig, validateConfig } from "./config.ts";
import { writeManaged } from "./managed.ts";
import { embedsAssets, renderHost, TAURI_CLI_VERSION } from "./templates.ts";
import { describeTarget } from "./target.ts";
import { mobileProblems, runNative, toolVersion } from "./tooling.ts";
import type { DefussTauriOptions, PreparedTauriProject, RunResult } from "./types.ts";
export type * from "./types.ts";
export { resolveConfig, validateConfig } from "./config.ts";
export { collectAssets } from "./assets.ts";

export async function prepareDefussTauri(options: DefussTauriOptions = {}): Promise<PreparedTauriProject> {
  const config = await resolveConfig(options);
  const manifest = await collectAssets(config);
  // Mobile hosts get their own directory so desktop/mobile runs do not keep regenerating each other.
  const host = config.mobile ? `${config.mobile}-${config.profile}` : config.profile;
  const base = join(config.managedDir, host);
  const mobileOutput = config.mobile === "ios" ? ["gen", "apple", "build"] : ["gen", "android", "app", "build", "outputs"];
  const prepared: PreparedTauriProject = {
    projectDir: config.projectDir, managedDir: config.managedDir, srcTauriDir: join(base, "src-tauri"), frontendDist: join(base, "bootstrap"),
    distributionDir: config.distributionDir,
    tauriBundleDir: config.mobile ? join(base, "src-tauri", ...mobileOutput) : join(config.distributionDir, ...(config.rustTarget ? [config.rustTarget] : []), config.command === "build" ? "release" : "debug", "bundle"),
    productName: config.appName, identifier: config.identifier, version: config.version, target: config.target, manifest, config,
  };
  if (!config.dryRun) {
    const snapshot = embedsAssets(config) ? await readAssetSnapshot(config, manifest) : new Map<string, Buffer>();
    await writeManaged(config.managedDir, host, await renderHost(config, manifest, snapshot));
  }
  return prepared;
}
export async function initDefussTauri(options: DefussTauriOptions = {}): Promise<RunResult> {
  const cwd = resolve(options.projectDir ?? ".");
  const file = resolve(cwd, options.config ?? "defuss-tauri.json");
  try { validateConfig(JSON.parse(await readFile(file, "utf8"))); return { code: "OK", message: `Existing configuration preserved: ${file}` }; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const { command: _command, projectDir: _dir, config: _file, skipInstall: _skip, debug: _debug, dryRun: _dry, prepareOnly: _prepare, ...input } = options;
  const data = validateConfig({ target: ".", ...input });
  // CLI paths use the invocation directory even when writing a config elsewhere.
  for (const key of ["target", "managedDirName", "tauriOutDir"] as const) {
    const value = key === "target" ? options.target ?? "." : options[key];
    if (value !== undefined && !(key === "target" && /^https?:\/\//iu.test(value))) {
      data[key] = relative(dirname(file), resolve(cwd, value)) || ".";
    }
  }
  if (!options.dryRun) { await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(data, null, 2) + "\n", { flag: "wx" }); }
  return { code: "OK", message: `${options.dryRun ? "Would create" : "Created"} ${file}` };
}
async function launch(options: DefussTauriOptions, command: "dev" | "build"): Promise<RunResult> {
  const prepared = await prepareDefussTauri({ ...options, command });
  const config = prepared.config;
  if (!config.dryRun && !config.prepareOnly) await runNative(prepared);
  const action = config.dryRun ? "Would prepare" : config.prepareOnly ? "Prepared" : command === "build" ? "Built" : "Closed";
  return { code: "OK", message: `${action} ${describeTarget(config.target)}; ${prepared.manifest.files.length} selected assets (${prepared.manifest.totalBytes} bytes). Host: ${prepared.srcTauriDir}${config.warnings.length ? "\n" + config.warnings.join("\n") : ""}`, prepared };
}
export const buildDefussTauri = (options: DefussTauriOptions = {}): Promise<RunResult> => launch(options, "build");
export const devDefussTauri = (options: DefussTauriOptions = {}): Promise<RunResult> => launch(options, "dev");
export async function doctorDefussTauri(options: DefussTauriOptions = {}): Promise<RunResult> {
  const { cwd, data } = await readConfig(options);
  // VERIFIED: mobileProblems takes only the platform, so prerequisites are reported even when the target does not resolve.
  const mobile = mobilePlatform(options.platform ?? data.platform ?? "native");
  let config: Awaited<ReturnType<typeof resolveConfig>> | null = null;
  let configurationError: string | null = null;
  try { config = await resolveConfig({ ...options, command: "doctor" }); } catch (error) { configurationError = error instanceof Error ? error.message : String(error); }
  const diagnostics = {
    cwd, node: process.version, cargo: options.dryRun ? null : toolVersion("cargo"), rustc: options.dryRun ? null : toolVersion("rustc"),
    target: config ? describeTarget(config.target) : null, configurationError,
    security: config?.security ?? null, warnings: config?.warnings ?? [],
    mobile: mobile && !options.dryRun ? { platform: mobile, missing: await mobileProblems(mobile) } : null,
    nativeCompilation: "UNKNOWN: doctor does not compile", serviceWorker: "UNKNOWN: requires native lifecycle probe",
    selfSignedTls: "DECIDED: CA-install model; platform validation applies, the app adds no TLS exceptions and edits no trust stores; install the dev server's CA on the OS or device",
  };
  return { code: configurationError || (!options.dryRun && (!diagnostics.cargo || !diagnostics.rustc || Boolean(diagnostics.mobile?.missing.length))) ? "FAILED" : "OK", message: JSON.stringify(diagnostics, null, 2), diagnostics };
}
export async function runDefussTauri(options: DefussTauriOptions = {}): Promise<RunResult> {
  const command = options.command ?? "dev";
  if (command === "init") return initDefussTauri(options);
  if (command === "doctor") return doctorDefussTauri(options);
  if (command === "build") return buildDefussTauri(options);
  if (command === "dev") return devDefussTauri(options);
  throw new Error(`Unknown command: ${String(command)}`);
}
export const defaults = Object.freeze({ managedDirName: ".defuss-tauri", tauriOutDir: "dist-tauri-build", tauriOutDevDir: "dist-tauri-dev", tauriCliVersion: TAURI_CLI_VERSION, security: "developer" });
