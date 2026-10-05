/** Public data contracts. No application framework or backend process appears here. */
export type DefussTauriCommand = "init" | "build" | "dev" | "doctor";
export type DefussTauriPlatform = "macos" | "windows" | "linux" | "native" | "ios" | "android";
export type MobilePlatform = "ios" | "android";
export interface DefussTauriWindowOptions {
  title?: string; width?: number; height?: number; resizable?: boolean; fullscreen?: boolean;
}
export interface AssetOptions {
  port?: number;
  spa?: boolean;
  /** Exact relative paths or directory prefixes; exclusions always win. */
  exclude?: string[];
  /** Explicit exceptions to default exclusions, never secrets or generated output. */
  include?: string[];
  headers?: Record<string, string>;
}
export interface DefussTauriConfig {
  target?: string; entry?: string; appName?: string; identifier?: string; version?: string;
  platform?: DefussTauriPlatform; rustTarget?: string; managedDirName?: string;
  tauriOutDir?: string; security?: "developer" | "strict";
  window?: DefussTauriWindowOptions; assets?: AssetOptions;
}
export interface DefussTauriOptions extends DefussTauriConfig {
  command?: DefussTauriCommand;
  /** Invocation directory. A positional web target is represented by target, not projectDir. */
  projectDir?: string;
  config?: string;
  skipInstall?: boolean; debug?: boolean; dryRun?: boolean; prepareOnly?: boolean;
}
export type ResolvedWebTarget =
  | { kind: "url"; url: string }
  | { kind: "directory"; root: string; entry: string };
export interface ResolvedConfig {
  command: DefussTauriCommand; projectDir: string; configFile: string | null;
  target: ResolvedWebTarget; appName: string; identifier: string; version: string;
  platform: DefussTauriPlatform; mobile: MobilePlatform | null; rustTarget: string | null;
  managedDir: string; distributionDir: string; profile: "dev" | "release";
  security: "developer" | "strict";
  window: Required<DefussTauriWindowOptions>;
  assets: { port: number | null; spa: boolean; exclude: string[]; include: string[]; headers: Record<string, string> };
  skipInstall: boolean; debug: boolean; dryRun: boolean; prepareOnly: boolean;
  warnings: string[];
}
export interface AssetRecord { path: string; bytes: number; sha256: string }
export interface AssetManifest { schema: 1; files: AssetRecord[]; totalBytes: number }
export interface PreparedTauriProject {
  projectDir: string; managedDir: string; srcTauriDir: string; frontendDist: string;
  distributionDir: string; tauriBundleDir: string;
  productName: string; identifier: string; version: string;
  target: ResolvedWebTarget; manifest: AssetManifest; config: ResolvedConfig;
}
export interface RunResult {
  code: "OK" | "FAILED"; message: string; prepared?: PreparedTauriProject;
  diagnostics?: Record<string, unknown>;
}
