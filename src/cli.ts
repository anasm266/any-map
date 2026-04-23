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
  .description("Classify `any` sources (m2) and optionally dump the intra-module graph (m3).")
  .argument("[path]", "Project file, directory, or tsconfig root", ".")
  .option("--json", "Emit scan summary as JSON", false)
  .option("--dump-graph", "Emit intra-module type-flow graph (nodes + edges) as JSON", false)
  .action(async (path: string | undefined, opts: { json?: boolean; dumpGraph?: boolean }) => {
    const flags: { json?: boolean; dumpGraph?: boolean } = {};
    if (opts.json === true) flags.json = true;
    if (opts.dumpGraph === true) flags.dumpGraph = true;
    await runScanCommand(path, flags);
  });

void program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
