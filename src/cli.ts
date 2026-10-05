#!/usr/bin/env node
import { parseArgs, usage } from "./args.ts";
import { runDefussTauri } from "./index.ts";
try {
  const { options, help, warnings } = parseArgs(process.argv.slice(2));
  if (help) console.log(usage);
  else {
    for (const warning of warnings) console.error(warning);
    const result = await runDefussTauri(options);
    console.log(result.message);
    // VERIFIED: exitCode, not process.exit(), so pending stdout writes to a pipe are not lost (Node process.exit docs).
    if (result.code !== "OK") process.exitCode = 1;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
