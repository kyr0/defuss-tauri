/** Deterministic asset selection. Never infer or install a project toolchain. */
import { createHash } from "node:crypto";
import { lstat, readdir, readFile, realpath } from "node:fs/promises";
import { join } from "node:path";
import { inside, relativeAssetPath } from "./target.ts";
import type { AssetManifest, ResolvedConfig } from "./types.ts";

export const hash = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");
const DEFAULT_EXCLUDES = new Set(["node_modules", "target", "coverage", "vendor", "dist-tauri-build", "dist-tauri-dev"]);
const HARD_EXCLUDES = new Set([".git", ".hg", ".svn", ".defuss-tauri", ".agents", ".github", ".githooks"]);
const prefix = (path: string, root: string): boolean => path === root || path.startsWith(`${root}/`);
function secret(path: string): boolean {
  return path.split("/").some(part => /^\.env(?:\.|$)/iu.test(part) || /\.(?:pem|key|p12|pfx)$/iu.test(part) || /^(?:id_rsa|id_ed25519)$/u.test(part));
}
export function selected(path: string, config: ResolvedConfig, directory = false): boolean {
  const parts = path.split("/");
  if (secret(path) || parts.some(part => HARD_EXCLUDES.has(part))) return false;
  if (config.assets.exclude.some(item => prefix(path, item))) return false;
  if (path === "defuss-tauri.json") return false;
  const explicit = config.assets.include.some(item => prefix(path, item));
  const descend = directory && config.assets.include.some(item => prefix(item, path));
  if (parts.some(part => DEFAULT_EXCLUDES.has(part) || (part.startsWith(".") && part !== ".well-known"))) return explicit || descend;
  return true;
}
export async function collectAssets(config: ResolvedConfig): Promise<AssetManifest> {
  const manifest: AssetManifest = { schema: 1, files: [], totalBytes: 0 };
  if (config.target.kind === "url") return manifest;
  const { root, entry } = config.target;
  const protectedPaths = [config.managedDir, config.distributionDir, ...(config.configFile ? [config.configFile] : [])];
  async function visit(logical: string): Promise<void> {
    const path = join(root, logical);
    if (protectedPaths.some(item => inside(item, path))) return;
    const info = await lstat(path);
    // Excluded entries are never dereferenced, e.g. dangling editor lock links such as `.#index.html`.
    if (logical && !selected(logical, config, info.isDirectory())) return;
    // Every selected symlink is rejected, so descendants of the canonical root are never links and need no realpath.
    if (info.isSymbolicLink()) {
      const actual = await realpath(path).catch(() => root);
      throw new Error(inside(root, actual) ? `Symlink asset is not supported; copy it into the declared root: ${logical}` : `Asset symlink escapes root: ${logical}`);
    }
    if (info.isDirectory()) {
      const children = (await readdir(path)).sort();
      for (const child of children) await visit(logical ? `${logical}/${child}` : child);
    } else if (info.isFile()) {
      if (relativeAssetPath(logical) !== logical) throw new Error(`Asset filename contains a non-portable separator: ${logical}`);
      const data = await readFile(path);
      manifest.files.push({ path: logical, bytes: data.length, sha256: hash(data) });
      manifest.totalBytes += data.length;
    } else throw new Error(`Asset is not a regular file/directory: ${logical}`);
  }
  await visit("");
  manifest.files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  if (!manifest.files.some(file => file.path === entry)) throw new Error("Selected HTML entry was excluded by the asset policy");
  return manifest;
}
export async function readAssetSnapshot(config: ResolvedConfig, manifest: AssetManifest): Promise<Map<string, Buffer>> {
  const snapshot = new Map<string, Buffer>();
  if (config.target.kind === "url") return snapshot;
  for (const item of manifest.files) {
    const path = join(config.target.root, item.path);
    const actual = await realpath(path);
    if (!inside(config.target.root, actual) || (await lstat(path)).isSymbolicLink()) throw new Error(`Asset changed to symlink: ${item.path}`);
    const data = await readFile(actual);
    if (data.length !== item.bytes || hash(data) !== item.sha256) throw new Error(`Asset changed during snapshot; retry: ${item.path}`);
    snapshot.set(item.path, data);
  }
  return snapshot;
}
