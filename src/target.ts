/** Target classification and containment are shared by configuration and staging. */
import { readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep, win32 } from "node:path";
import type { ResolvedWebTarget } from "./types.ts";

export function inside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}
/** VERIFIED: rejects C0 controls and DEL; a char-code test replaces the control-character regexes oxlint's no-control-regex flags. */
export const hasControlCharacter = (value: string): boolean => [...value].some(char => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f);
/** Loopback names resolve to the device running the WebView, not necessarily the development machine. */
export const loopback = (hostname: string): boolean => /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/u.test(hostname);
export function relativeAssetPath(value: string, label = "asset path"): string {
  const normalized = value.replaceAll("\\", "/");
  if (!normalized || hasControlCharacter(normalized) || isAbsolute(value) || win32.isAbsolute(value)
      || normalized.split("/").some(part => !part || part === "." || part === ".." || part.includes(":"))) {
    throw new Error(`${label} must be a nonempty relative path without traversal: ${JSON.stringify(value)}`);
  }
  return normalized;
}
export async function resolveTarget(raw: string, base: string, entry?: string): Promise<ResolvedWebTarget> {
  if (/^https?:/iu.test(raw)) {
    let url: URL;
    try { url = new URL(raw); } catch { throw new Error("Invalid HTTP(S) target URL"); }
    if (!/^https?:\/\//iu.test(raw) || !url.hostname || /\s/u.test(raw) || hasControlCharacter(raw) || raw.includes("\\")) {
      throw new Error("Use a complete HTTP(S) URL; percent-encode whitespace and do not use backslashes");
    }
    if (url.username || url.password) throw new Error("Put credentials in the service's login flow, not the target URL");
    if (entry !== undefined) throw new Error("entry applies only to a directory target");
    return { kind: "url", url: raw };
  }
  if (/^[a-z][a-z\d+.-]*:/iu.test(raw) && !/^[a-z]:[\\/]/iu.test(raw)) {
    throw new Error("Unsupported target scheme; use HTTP(S) or a local directory");
  }
  if (process.platform !== "win32" && win32.isAbsolute(raw) && !raw.startsWith("/")) {
    throw new Error("A Windows drive/UNC path must be resolved on Windows");
  }
  const candidate = resolve(base, raw);
  let root: string;
  try {
    root = await realpath(candidate);
    if (!(await stat(root)).isDirectory()) throw new Error("not a directory");
  } catch { throw new Error(`Target is not an existing directory: ${candidate}`); }
  let selected = entry;
  if (selected === undefined) {
    const names = (await readdir(root, { withFileTypes: true }))
      .filter(item => item.isFile() && /\.html?$/iu.test(item.name)).map(item => item.name).sort();
    selected = names.includes("index.html") ? "index.html" : names.length === 1 ? names[0] : undefined;
    if (selected === undefined) throw new Error(`Directory has ${names.length} root HTML candidates; set entry explicitly`);
  }
  selected = relativeAssetPath(selected, "entry");
  let file: string;
  try { file = await realpath(join(root, selected)); } catch { throw new Error(`Missing HTML entry: ${selected}`); }
  if (!inside(root, file) || !(await stat(file)).isFile() || !/\.html?$/iu.test(selected)) {
    throw new Error("entry must be an HTML file inside the target root");
  }
  return { kind: "directory", root, entry: relative(root, file).split(sep).join("/") };
}
export function describeTarget(target: ResolvedWebTarget): string {
  if (target.kind === "directory") return target.root;
  const url = new URL(target.url);
  // URL query and fragment frequently contain tokens; never emit them to logs.
  return `${url.origin}${url.pathname}${url.search ? "?[redacted]" : ""}${url.hash ? "#[redacted]" : ""}`;
}
