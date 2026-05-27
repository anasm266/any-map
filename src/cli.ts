#!/usr/bin/env node
import { Command } from "commander";
import {
  parseIgnoreGlobsList,
  parseSourceKindsList,
} from "./analyzer/filter-sources.js";
import { runDiffCommand, type DiffCliFormat } from "./commands/diff.js";
import { runGraphCommand } from "./commands/graph.js";
import { runScanCommand, type ScanCliFormat } from "./commands/scan.js";
import { runTraceCommand } from "./commands/trace.js";

declare const __ANY_MAP_VERSION__: string;

const program = new Command();

program
  .name("any-map")
  .description("Static flow analysis for TypeScript `any` types.")
  .version(__ANY_MAP_VERSION__);

function parsePctOpt(
  raw: string | undefined,
  label: string,
): number | undefined {
  if (raw === undefined) return undefined;
  const t = raw.trim().replace(/%$/, "");
  const n = Number.parseFloat(t);
  if (!Number.isFinite(n) || n < 0 || n > 100) {
    console.error(
      `any-map scan: ${label} must be a number from 0 to 100 (optional % suffix)`,
    );
    process.exitCode = 1;
    return undefined;
  }
  return n;
}

function parseReportVersion(
  raw: string | undefined,
  cmd: string,
): 1 | 2 | undefined {
  if (raw === undefined) return undefined;
  if (raw === "1" || raw === "2") return Number(raw) as 1 | 2;
  console.error(`${cmd}: --report-version must be 1 or 2`);
  process.exitCode = 1;
  return undefined;
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

function scanFormatFromOpts(opts: {
  format?: string;
  json?: boolean;
}): ScanCliFormat | undefined {
  if (process.exitCode) return undefined;
  if (opts.format !== undefined) {
    if (
      opts.format !== "table" &&
      opts.format !== "json" &&
      opts.format !== "dot" &&
      opts.format !== "sarif"
    ) {
      console.error(
        "any-map scan: --format must be table, json, dot, or sarif",
      );
      process.exitCode = 1;
      return undefined;
    }
    return opts.format;
  }
  if (opts.json === true) return "json";
  return "table";
}

function diffFormatFromOpts(opts: {
  format?: string;
  json?: boolean;
}): DiffCliFormat | undefined {
  if (process.exitCode) return undefined;
  if (opts.format !== undefined) {
    if (
      opts.format !== "table" &&
      opts.format !== "json" &&
      opts.format !== "sarif"
    ) {
      console.error("any-map diff: --format must be table, json, or sarif");
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
  .option("--format <mode>", "Output: table, json, dot (Graphviz), or sarif")
  .option(
    "--report-version <n>",
    "JSON report schema version (default 2; use 1 for legacy flat ScanSummary)",
  )
  .option("--json", "Same as --format json", false)
  .option(
    "--dump-graph",
    "Emit intra-module graph JSON (nodes + edges + infectedBy)",
    false,
  )
  .option(
    "--max-files <n>",
    "Cap TypeScript program root files (escape hatch for huge repos)",
  )
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
  .option(
    "--fail-above <n>",
    "Exit 1 if the number of any sources is greater than N",
  )
  .option(
    "--fail-coverage <pct>",
    "(deprecated) alias for --fail-top3-greedy-pct",
  )
  .option(
    "--fail-top3-greedy-pct <pct>",
    "Exit 1 if top-3 greedy cumulative coverage is below pct (0–100)",
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
        failTop3GreedyPct?: string;
        reportVersion?: string;
        maxFiles?: string;
      },
    ) => {
      const format = scanFormatFromOpts(opts);
      if (format === undefined) return;

      const flags: Parameters<typeof runScanCommand>[1] = {
        format,
        toolVersion: __ANY_MAP_VERSION__,
      };
      if (opts.json === true) flags.json = true;
      if (opts.dumpGraph === true) flags.dumpGraph = true;

      if (opts.maxFiles !== undefined) {
        const n = Number.parseInt(opts.maxFiles, 10);
        if (!Number.isInteger(n) || n < 1) {
          console.error("any-map scan: --max-files must be a positive integer");
          process.exitCode = 1;
          return;
        }
        flags.maxFiles = n;
      }

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

      const rv = parseReportVersion(opts.reportVersion, "any-map scan");
      if (rv !== undefined) flags.reportVersion = rv;

      if (opts.failCoverage !== undefined) {
        console.warn(
          "any-map scan: --fail-coverage is deprecated; use --fail-top3-greedy-pct",
        );
        const v = parsePctOpt(opts.failCoverage, "--fail-coverage");
        if (v === undefined) return;
        flags.failCoveragePct = v;
      }

      if (opts.failTop3GreedyPct !== undefined) {
        const v = parsePctOpt(opts.failTop3GreedyPct, "--fail-top3-greedy-pct");
        if (v === undefined) return;
        flags.failTop3GreedyPct = v;
      }

      await runScanCommand(path, flags);
    },
  );

program
  .command("diff")
  .description(
    "Compare branch-introduced `any` deltas between two refs using merge-base semantics.",
  )
  .argument("<base>", "Base ref (merge-base is computed against head)")
  .argument("<head>", "Head ref to analyze")
  .argument("[path]", "Project file, directory, or tsconfig root", ".")
  .option("--format <mode>", "Output: table, json, or sarif")
  .option("--json", "Same as --format json", false)
  .option(
    "--report-version <n>",
    "JSON report schema version (default 2; use 1 for legacy DiffSummary)",
  )
  .option("--fail-on-new-sources", "Exit 1 if any new sources appear in scope")
  .option(
    "--fail-on-infected-increase",
    "Exit 1 if infected node count increased",
  )
  .option(
    "--fail-on-blast-increase",
    "Exit 1 if any source blast radius increased",
  )
  .option(
    "--max-new-sources <n>",
    "Exit 1 if more than N new sources appear in scope",
  )
  .option("--no-cache", "Disable `.any-map-cache/` when diffing", false)
  .option("--max-files <n>", "Cap TypeScript program root files per scan")
  .option(
    "--top <n>",
    "Limit rows in added/removed/blast-changed sections and in JSON delta arrays",
  )
  .option(
    "--source-kinds <list>",
    "Comma-separated kinds: explicit-any, as-any, untyped-import, untyped-return, catch-binding, implicit-param",
  )
  .option(
    "--ignore <globs>",
    "Comma-separated picomatch globs; matching files excluded from sources",
  )
  .action(
    async (
      baseRef: string,
      headRef: string,
      scanPath: string | undefined,
      opts: {
        format?: string;
        json?: boolean;
        top?: string;
        sourceKinds?: string;
        ignore?: string;
        reportVersion?: string;
        failOnNewSources?: boolean;
        failOnInfectedIncrease?: boolean;
        failOnBlastIncrease?: boolean;
        maxNewSources?: string;
        noCache?: boolean;
        maxFiles?: string;
      },
    ) => {
      const format = diffFormatFromOpts(opts);
      if (format === undefined) return;

      const flags: Parameters<typeof runDiffCommand>[3] = {
        format,
        toolVersion: __ANY_MAP_VERSION__,
      };

      if (opts.json === true) flags.json = true;

      if (opts.top !== undefined) {
        const n = Number.parseInt(opts.top, 10);
        if (!Number.isInteger(n) || n < 1) {
          console.error("any-map diff: --top must be a positive integer");
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

      const rv = parseReportVersion(opts.reportVersion, "any-map diff");
      if (rv !== undefined) flags.reportVersion = rv;

      if (opts.failOnNewSources === true) flags.failOnNewSources = true;
      if (opts.failOnInfectedIncrease === true)
        flags.failOnInfectedIncrease = true;
      if (opts.failOnBlastIncrease === true) flags.failOnBlastIncrease = true;

      if (opts.maxNewSources !== undefined) {
        const n = Number.parseInt(opts.maxNewSources, 10);
        if (!Number.isInteger(n) || n < 0) {
          console.error(
            "any-map diff: --max-new-sources must be a non-negative integer",
          );
          process.exitCode = 1;
          return;
        }
        flags.maxNewSources = n;
      }

      if (opts.noCache === true) flags.useCache = false;

      if (opts.maxFiles !== undefined) {
        const n = Number.parseInt(opts.maxFiles, 10);
        if (!Number.isInteger(n) || n < 1) {
          console.error("any-map diff: --max-files must be a positive integer");
          process.exitCode = 1;
          return;
        }
        flags.maxFiles = n;
      }

      await runDiffCommand(baseRef, headRef, scanPath, flags);
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
  .description(
    "Show type-flow paths from each contributing `any` source to a symbol (m5).",
  )
  .argument(
    "<loc>",
    "file:line:column or file:line (project-relative path recommended)",
  )
  .argument("[path]", "Project file, directory, or tsconfig root", ".")
  .option("--json", "Emit trace report as JSON", false)
  .action(
    async (
      loc: string,
      scanPath: string | undefined,
      opts: { json?: boolean },
    ) => {
      const flags: { json?: boolean } = {};
      if (opts.json === true) flags.json = true;
      await runTraceCommand(loc, scanPath, flags);
    },
  );

void program.parseAsync(process.argv).catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
