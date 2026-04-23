#!/usr/bin/env node
import { Command } from "commander";
import { parseIgnoreGlobsList, parseSourceKindsList } from "./analyzer/filter-sources.js";
import { runGraphCommand } from "./commands/graph.js";
import { runScanCommand, type ScanCliFormat } from "./commands/scan.js";
import { runTraceCommand } from "./commands/trace.js";

const program = new Command();

program
  .name("any-map")
  .description("Static flow analysis for TypeScript any types (pre-1.0).")
  .version("0.0.0");

function parseFailCoverageOpt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim().replace(/%$/, "");
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    console.error(
      "any-map scan: --fail-coverage must be a number from 0 to 100 (optional % suffix)",
    );
    process.exitCode = 1;
    return undefined;
  }
  return n;
}

function parseFailAboveOpt(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 0) {
    console.error("any-map scan: --fail-above must be a non-negative integer");
    process.exitCode = 1;
    return undefined;
  }
  return n;
}

function scanFormatFromOpts(opts: { format?: string; json?: boolean }): ScanCliFormat | undefined {
  if (process.exitCode) return undefined;
  if (opts.format !== undefined) {
    if (opts.format !== "table" && opts.format !== "json" && opts.format !== "dot") {
      console.error("any-map scan: --format must be table, json, or dot");
      process.exitCode = 1;
      return undefined;
    }
    return opts.format;
  }
  if (opts.json === true) return "json";
  return "table";
}

program
  .command("scan")
  .description(
    "Classify `any` sources, graph + propagation, blast + greedy ranking; optional DOT / JSON.",
  )
  .argument("[path]", "Project file, directory, or tsconfig root", ".")
  .option("--format <mode>", "Output: table, json, or dot (Graphviz)")
  .option("--json", "Same as --format json", false)
  .option("--dump-graph", "Emit intra-module graph JSON (nodes + edges + infectedBy)", false)
  .option(
    "--top <n>",
    "Limit rows in both table sections and in JSON `greedyCoverPicks` / `sourcesRankedByBlast` (CI thresholds still use full greedy coverage)",
  )
  .option(
    "--source-kinds <list>",
    "Comma-separated kinds: explicit-any, as-any, untyped-import, untyped-return, catch-binding, implicit-param",
  )
  .option(
    "--ignore <globs>",
    "Comma-separated picomatch globs; matching files excluded from sources",
  )
  .option("--fail-above <n>", "Exit 1 if the number of any sources is greater than N")
  .option(
    "--fail-coverage <pct>",
    "Exit 1 if top-3 greedy cumulative coverage %% is below pct (0–100, optional %% suffix)",
  )
  .action(
    async (
      path: string | undefined,
      opts: {
        format?: string;
        json?: boolean;
        dumpGraph?: boolean;
        top?: string;
        sourceKinds?: string;
        ignore?: string;
        failAbove?: string;
        failCoverage?: string;
      },
    ) => {
      const format = scanFormatFromOpts(opts);
      if (format === undefined) return;

      const flags: Parameters<typeof runScanCommand>[1] = { format };
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

      if (opts.sourceKinds) {
        try {
          flags.sourceKinds = parseSourceKindsList(opts.sourceKinds);
        } catch (e) {
          console.error(e instanceof Error ? e.message : e);
          process.exitCode = 1;
          return;
        }
      }

      if (opts.ignore) {
        flags.ignoreGlobs = parseIgnoreGlobsList(opts.ignore);
      }

      if (opts.failAbove !== undefined) {
        const v = parseFailAboveOpt(opts.failAbove);
        if (v === undefined) return;
        flags.failAbove = v;
      }

      if (opts.failCoverage !== undefined) {
        const v = parseFailCoverageOpt(opts.failCoverage);
        if (v === undefined) return;
        flags.failCoveragePct = v;
      }

      await runScanCommand(path, flags);
    },
  );

program
  .command("graph")
  .description("Emit the intra-module type-flow graph as Graphviz DOT (m6).")
  .argument("[path]", "Project file, directory, or tsconfig root", ".")
  .option("-o, --output <file>", "Write DOT to file (default: stdout)")
  .option("--source-kinds <list>", "Same as scan --source-kinds")
  .option("--ignore <globs>", "Same as scan --ignore")
  .action(
    async (
      scanPath: string | undefined,
      opts: { output?: string; sourceKinds?: string; ignore?: string },
    ) => {
      const o: Parameters<typeof runGraphCommand>[1] = {};
      if (opts.output !== undefined) o.output = opts.output;
      if (opts.sourceKinds) {
        try {
          o.sourceKinds = parseSourceKindsList(opts.sourceKinds);
        } catch (e) {
          console.error(e instanceof Error ? e.message : e);
          process.exitCode = 1;
          return;
        }
      }
      if (opts.ignore) o.ignoreGlobs = parseIgnoreGlobsList(opts.ignore);
      await runGraphCommand(scanPath, o);
    },
  );

program
  .command("trace")
  .description("Show type-flow paths from each contributing `any` source to a symbol (m5).")
  .argument("<loc>", "file:line:column or file:line (project-relative path recommended)")
  .argument("[path]", "Project file, directory, or tsconfig root", ".")
  .option("--json", "Emit trace report as JSON", false)
  .action(async (loc: string, scanPath: string | undefined, opts: { json?: boolean }) => {
    const flags: { json?: boolean } = {};
    if (opts.json === true) flags.json = true;
    await runTraceCommand(loc, scanPath, flags);
  });

void program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
