/** Generated files are replaceable only while their recorded hashes still match. */
import { lstat, mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { hash } from "./assets.ts";
import { relativeAssetPath } from "./target.ts";
const OWNER = "defuss-tauri-url-folder-v1";
interface Ownership { owner: string; files: Record<string, string> }
async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error; }
}
async function regular(path: string): Promise<void> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Generated file is not a regular file: ${path}`);
}
export async function initializeManaged(root: string): Promise<void> {
  if (await exists(root)) {
    const info = await lstat(root);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Managed root must be a real directory");
    const marker = join(root, "owner.json");
    if (!(await exists(marker))) throw new Error(`Unowned/legacy managed directory: ${root}. Preserve it and choose --managed-dir .defuss-tauri-v2; no legacy files are deleted.`);
    await regular(marker);
    if (JSON.parse(await readFile(marker, "utf8")).owner !== OWNER) throw new Error("Managed directory has a different owner");
    return;
  }
  await mkdir(root, { recursive: true });
  await writeFile(join(root, "owner.json"), JSON.stringify({ owner: OWNER, schema: 1 }) + "\n", { flag: "wx" });
}
export async function writeManaged(root: string, profile: string, files: Map<string, Buffer>): Promise<void> {
  if (!/^(?:(?:ios|android)-)?(?:dev|release)$/u.test(profile)) throw new Error("Invalid generated profile");
  await initializeManaged(root);
  const lock = join(root, ".generation-lock");
  try { await mkdir(lock); } catch { throw new Error(`Generation is locked: ${lock}. Remove only after confirming no other generator is running.`); }
  try {
    const base = join(root, profile);
    if (await exists(base)) {
      const info = await lstat(base);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Generated profile must be a real directory, not a symlink");
    }
    const statePath = join(base, "generated.json");
    let previous: Ownership = { owner: OWNER, files: {} };
    if (await exists(statePath)) {
      await regular(statePath);
      previous = JSON.parse(await readFile(statePath, "utf8")) as Ownership;
      if (previous.owner !== OWNER || !previous.files || typeof previous.files !== "object" || Array.isArray(previous.files)) throw new Error("Invalid generated ownership manifest");
    } else if (await exists(base)) throw new Error(`Unowned generated profile: ${base}`);
    for (const [rel, expected] of Object.entries(previous.files)) {
      relativeAssetPath(rel);
      const path = join(base, rel);
      if (!(await exists(path))) throw new Error(`Generated file was deleted: ${rel}; use a new managed directory`);
      await regular(path);
      if (hash(await readFile(path)) !== expected) throw new Error(`Generated file was edited; preserving it: ${rel}. Use a new managed directory or restore it explicitly.`);
    }
    async function checkTree(dir: string, prefix = ""): Promise<void> {
      if (!(await exists(dir))) return;
      for (const item of await readdir(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${item.name}` : item.name;
        // Tauri owns gen/: schemas plus the Xcode/Gradle projects (with build trees and Pods symlinks) from mobile init.
        // Dirent reports a symlink as not-a-directory, so a redirected gen/ still fails the symlink check below.
        if (rel === "src-tauri/gen" && item.isDirectory()) continue;
        if (item.isSymbolicLink()) throw new Error(`Symlink in managed project: ${rel}`);
        if (item.isDirectory()) { await checkTree(join(dir, item.name), rel); continue; }
        // Cargo owns its lock files, not target application files.
        if (rel === "generated.json" || rel === "src-tauri/Cargo.lock" || rel === "src-tauri/transport/Cargo.lock") continue;
        if (!(rel in previous.files)) throw new Error(`Unowned file in generated host: ${rel}; preserving it`);
      }
    }
    await checkTree(base);
    const next: Ownership = { owner: OWNER, files: {} };
    for (const [rel, bytes] of files) {
      relativeAssetPath(rel);
      const path = join(base, rel);
      await mkdir(dirname(path), { recursive: true });
      // Validate ancestors because writable workspaces are not a trust boundary.
      let parent = dirname(path);
      while (parent !== base) { if ((await lstat(parent)).isSymbolicLink()) throw new Error(`Symlink in generated path: ${parent}`); parent = dirname(parent); }
      const temporary = `${path}.defuss-next`;
      await writeFile(temporary, bytes, { flag: "wx" });
      await rename(temporary, path);
      next.files[rel] = hash(bytes);
    }
    for (const rel of Object.keys(previous.files)) if (!files.has(rel)) await rm(join(base, rel));
    await writeFile(`${statePath}.next`, JSON.stringify(next, null, 2) + "\n", { flag: "wx" });
    await rename(`${statePath}.next`, statePath);
  } finally { await rm(lock, { recursive: true }); }
}
