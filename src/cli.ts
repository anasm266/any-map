#!/usr/bin/env node
import { Command } from "commander";
import { runScanCommand } from "./commands/scan.js";

const program = new Command();

program
  .name("any-map")
  .description("Static flow analysis for TypeScript any types (pre-1.0).")
  .version("0.0.0");

program
  .command("scan")
  .description("Classify TypeScript `any` sources (milestone m2: six kinds).")
  .argument("[path]", "Project file, directory, or tsconfig root", ".")
  .option("--json", "Emit machine-readable JSON", false)
  .action(async (path: string | undefined, opts: { json?: boolean }) => {
    const flags = opts.json === true ? { json: true as const } : {};
    await runScanCommand(path, flags);
  });

void program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
