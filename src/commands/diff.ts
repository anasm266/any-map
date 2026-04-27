import Table from "cli-table3";
import pc from "picocolors";
import {
  diffScan,
  summarizeDiffTotals,
  type DiffScanOptions,
} from "../analyzer/diff-scan.js";
import type {
  BlastChangedSource,
  DiffSummary,
  SourceKind,
  SourceRanked,
} from "../types.js";

export type DiffCliFormat = "table" | "json";

export interface DiffCliOptions {
  format?: DiffCliFormat;
  /** @deprecated use format === "json" */
  json?: boolean;
  top?: number;
  sourceKinds?: SourceKind[];
  ignoreGlobs?: string[];
}

function signed(n: number): string {
  if (n > 0) return `+${n}`;
  return String(n);
}

function shortRef(ref: string): string {
  return ref.slice(0, 12);
}

function printSourceDeltaTable(title: string, sources: SourceRanked[]): void {
  if (sources.length === 0) return;
  console.log("");
  console.log(pc.bold(title));
  const table = new Table({
    head: [
      pc.dim("Blast"),
      pc.dim("Rank"),
      pc.dim("File"),
      pc.dim("Line:Col"),
      pc.dim("Kind"),
      pc.dim("Name"),
    ],
    wordWrap: true,
  });
  for (const source of sources) {
    table.push([
      String(source.blastRadius),
      String(source.rank),
      source.filePath,
      `${source.line}:${source.column}`,
      source.sourceKind,
      source.name,
    ]);
  }
  console.log(table.toString());
}

function printBlastChangedTable(changes: BlastChangedSource[]): void {
  if (changes.length === 0) return;
  console.log("");
  console.log(pc.bold("Blast radius changes"));
  const table = new Table({
    head: [
      pc.dim("Delta"),
      pc.dim("Before"),
      pc.dim("After"),
      pc.dim("File"),
      pc.dim("Line:Col"),
      pc.dim("Kind"),
      pc.dim("Name"),
    ],
    wordWrap: true,
  });
  for (const change of changes) {
    table.push([
      signed(change.deltaBlastRadius),
      String(change.before.blastRadius),
      String(change.after.blastRadius),
      change.after.filePath,
      `${change.after.line}:${change.after.column}`,
      change.after.sourceKind,
      change.after.name,
    ]);
  }
  console.log(table.toString());
}

function printDiffTables(summary: DiffSummary): void {
  const totals = summarizeDiffTotals(summary);
  console.log(
    pc.dim(
      `Comparing ${summary.requestedBaseRef}..${summary.requestedHeadRef} via merge-base ${shortRef(summary.effectiveBaseRef)} against ${shortRef(summary.effectiveHeadRef)} [scope: ${summary.scope}]`,
    ),
  );
  console.log(pc.dim(`Changed files in scope: ${summary.changedFiles.length}`));
  if (summary.scope === "full-project-fallback") {
    console.log(
      pc.dim(
        "Using full-project fallback because the diff touched tsconfig/package metadata, lockfiles, or declaration files.",
      ),
    );
  }
  console.log(
    pc.bold(
      `Totals: sources ${totals.beforeSourceCount} -> ${totals.afterSourceCount} (${signed(totals.sourceDelta)}), infected ${totals.beforeInfectedNodeCount} -> ${totals.afterInfectedNodeCount} (${signed(totals.infectedNodeDelta)}), top-3 coverage ${totals.beforeTop3CoveragePct}% -> ${totals.afterTop3CoveragePct}% (${signed(totals.top3CoverageDeltaPct)}pp)`,
    ),
  );

  printSourceDeltaTable("Added sources", summary.addedSources);
  printSourceDeltaTable("Removed sources", summary.removedSources);
  printBlastChangedTable(summary.blastChangedSources);

  if (
    summary.addedSources.length === 0 &&
    summary.removedSources.length === 0 &&
    summary.blastChangedSources.length === 0
  ) {
    console.log("");
    console.log(pc.dim("No any-source deltas in the reported scope."));
  }
}

export async function runDiffCommand(
  baseRef: string,
  headRef: string,
  targetPath: string | undefined,
  options: DiffCliOptions,
): Promise<void> {
  const scanOptions: DiffScanOptions = {
    targetPath: targetPath ?? ".",
    baseRef,
    headRef,
  };
  if (options.sourceKinds !== undefined)
    scanOptions.sourceKinds = options.sourceKinds;
  if (options.ignoreGlobs !== undefined)
    scanOptions.ignoreGlobs = options.ignoreGlobs;
  if (options.top !== undefined) scanOptions.top = options.top;

  const format: DiffCliFormat =
    options.format ?? (options.json === true ? "json" : "table");
  const summary = diffScan(scanOptions);

  if (format === "json") {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  printDiffTables(summary);
}
