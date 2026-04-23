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
  .description(
    "Classify `any` sources (m2), intra-module graph (m3), blast-ranked output (m4); optional graph JSON dump.",
  )
  .argument("[path]", "Project file, directory, or tsconfig root", ".")
  .option("--json", "Emit scan summary as JSON", false)
  .option("--dump-graph", "Emit intra-module type-flow graph (nodes + edges) as JSON", false)
  .option("--top <n>", "Limit blast-ranked rows in table / JSON `sourcesRankedByBlast`")
  .action(
    async (path: string | undefined, opts: { json?: boolean; dumpGraph?: boolean; top?: string }) => {
      const flags: { json?: boolean; dumpGraph?: boolean; top?: number } = {};
      if (opts.json === true) flags.json = true;
      if (opts.dumpGraph === true) flags.dumpGraph = true;
      if (opts.top !== undefined) {
        const n = Number.parseInt(opts.top, 10);
        if (!Number.isInteger(n) || n < 1) {
          console.error("any-map scan: --top must be a positive integer");
          process.exitCode = 1;
          return;
        }
        flags.top = n;
      }
      await runScanCommand(path, flags);
    },
  );

void program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
