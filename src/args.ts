/** Side-effect-free parser; --target retains its historical Rust-only interpretation. */
import type { DefussTauriCommand, DefussTauriOptions, DefussTauriPlatform } from "./types.ts";
const commands = new Set(["dev", "build", "init", "doctor"]);
const removed = new Set(["--node-version", "--node-dist-base-url", "--skip-node", "--skip-ssg", "--skip-ssg-install", "--ssg-output"]);
export interface ParsedArgs { options: DefussTauriOptions; help: boolean; warnings: string[] }
export function parseArgs(args: string[]): ParsedArgs {
  const options: DefussTauriOptions = {};
  const warnings: string[] = [];
  const positional: string[] = [];
  let help = false;
  let literal = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (literal) { positional.push(arg); continue; }
    if (arg === "--") { literal = true; continue; }
    const split = arg.indexOf("=");
    const flag = split < 0 ? arg : arg.slice(0, split);
    const inline = split < 0 ? undefined : arg.slice(split + 1);
    if (removed.has(flag)) throw new Error(`${flag} was removed. Build/serve your frontend independently and pass its URL or static output directory.`);
    if (flag === "--host" || flag === "-H") throw new Error("--host was removed. A URL owns its host; the static transport binds only 127.0.0.1.");
    const value = (): string => {
      const item = inline ?? args[++i];
      if (!item || (inline === undefined && item.startsWith("-"))) throw new Error(`Missing value for ${flag}`);
      return item;
    };
    if (["--help", "-h", "--debug", "-d", "--dry-run", "--skip-install", "--prepare-only", "--strict-security"].includes(flag) && inline !== undefined) throw new Error(`${flag} does not take a value`);
    switch (flag) {
      case "--help": case "-h": help = true; break;
      case "--debug": case "-d": options.debug = true; break;
      case "--dry-run": options.dryRun = true; break;
      case "--skip-install": options.skipInstall = true; break;
      case "--prepare-only": options.prepareOnly = true; break;
      case "--strict-security": options.security = "strict"; break;
      case "--config": options.config = value(); break;
      case "--entry": options.entry = value(); break;
      case "--app-name": options.appName = value(); break;
      case "--identifier": options.identifier = value(); break;
      case "--version": options.version = value(); break;
      case "--managed-dir": options.managedDirName = value(); break;
      case "--tauri-out": options.tauriOutDir = value(); break;
      case "--platform": options.platform = value() as DefussTauriPlatform; break;
      case "--target": warnings.push("--target is deprecated; use --rust-target. Put web targets in the positional argument or JSON target field.");
        // Both spellings retain the same unambiguous meaning.
      case "--rust-target": {
        const next = value();
        if (options.rustTarget !== undefined && options.rustTarget !== next) throw new Error("Conflicting Rust target options");
        options.rustTarget = next; break;
      }
      case "--port": case "-p": {
        const port = Number(value());
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Static port must be in 1..65535");
        options.assets = { ...options.assets, port }; break;
      }
      default: if (arg.startsWith("-")) throw new Error(`Unknown option: ${flag}`); positional.push(arg);
    }
  }
  if (positional.length && commands.has(positional[0]!)) options.command = positional.shift() as DefussTauriCommand;
  else options.command = "dev";
  if (positional.length > 1) throw new Error("Too many positional arguments; expected one URL or directory");
  if (positional[0] !== undefined) options.target = positional[0];
  return { options, help, warnings };
}
export const usage = `Usage: defuss-tauri [dev|build|init|doctor] [HTTP(S)-URL|directory] [options]

No args: dev using ./defuss-tauri.json, or the current directory.
Configuration values are relative to the configuration file. CLI paths are relative to cwd.

  --config <file>       JSON configuration (no parent discovery)
  --entry <file.html>   Directory entry; default index.html or sole root HTML file
  --platform <native|macos|windows|linux|ios|android>
  --rust-target <triple>  Native compilation target (--target is deprecated alias)
  --app-name <name> --identifier <reverse.dns.id> --version <semver>
  --managed-dir <dir>   Owned generated hosts; default .defuss-tauri
  --tauri-out <dir>     Cargo build/bundle output, never target application data
  --port, -p <port>     Static loopback port only; otherwise allocated once/persisted
  --strict-security    Disable wrapper developer inspector; does not rewrite web policy
  --prepare-only       Generate native source without executing a toolchain
  --skip-install       Do not install missing managed Tauri CLI (build tooling only)
  --dry-run            Read/validate/describe only; NO writes or external commands
  --debug, -d          Native tool verbosity, NOT Cargo debug-profile selection
  --help, -h

External services are never started/stopped/built/installed by this CLI.
Self-signed HTTPS adapters and cross-platform service-worker certification remain open native gates.
`;
