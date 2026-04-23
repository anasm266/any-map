import Table from "cli-table3";
import pc from "picocolors";
import { buildScanOptions, runFullScan } from "../analyzer/run-scan.js";
import type { ScanSummary, SourceKind } from "../types.js";
import { serializedGraphToDot } from "../format/to-dot.js";
import { applyScanFailureResult, evaluateScanFailure } from "./scan-failure.js";

export type ScanCliFormat = "table" | "json" | "dot";

export interface ScanCliOptions {
  format?: ScanCliFormat;
  /** @deprecated use format === "json" */
  json?: boolean;
  dumpGraph?: boolean;
  top?: number;
  sourceKinds?: SourceKind[];
  ignoreGlobs?: string[];
  failAbove?: number;
  failCoveragePct?: number;
}

export async function runScanCommand(
  targetPath: string | undefined,
  options: ScanCliOptions,
): Promise<void> {
  const basePath = targetPath ?? ".";
  const format: ScanCliFormat = options.format ?? (options.json === true ? "json" : "table");

  if (options.dumpGraph === true) {
    const { summary, serializedGraph } = runFullScan(
      buildScanOptions(basePath, options.sourceKinds, options.ignoreGlobs),
    );
    console.log(JSON.stringify(serializedGraph, null, 2));
    applyScanFailureResult(evaluateScanFailure(summary, options));
    return;
  }

  const { summary, serializedGraph } = runFullScan(
    buildScanOptions(basePath, options.sourceKinds, options.ignoreGlobs, options.top),
  );

  if (format === "json") {
    console.log(JSON.stringify(summary, null, 2));
    applyScanFailureResult(evaluateScanFailure(summary, options));
    return;
  }

  if (format === "dot") {
    console.log(serializedGraphToDot(serializedGraph));
    applyScanFailureResult(evaluateScanFailure(summary, options));
    return;
  }

  printScanTables(summary);
  applyScanFailureResult(evaluateScanFailure(summary, options));
}

function printScanTables(summary: ScanSummary): void {
  const n = summary.sources.length;
  const files = summary.fileCount;

  console.log(
    pc.bold(
      `Found ${n} any source${n === 1 ? "" : "s"}, ${summary.infectedNodeCount} infected graph node${
        summary.infectedNodeCount === 1 ? "" : "s"
      } in ${files} project file${files === 1 ? "" : "s"}.`,
    ),
  );

  if (n === 0) {
    return;
  }

  if (summary.greedyCoverPicks.length > 0) {
    console.log("");
    console.log(pc.bold("Fix order (greedy set-cover)"));
    const greedyTable = new Table({
      head: [
        pc.dim("Pick"),
        pc.dim("Cum.%"),
        pc.dim("+Nodes"),
        pc.dim("Blast"),
        pc.dim("Bl#"),
        pc.dim("File"),
        pc.dim("Line:Col"),
        pc.dim("Kind"),
        pc.dim("Name"),
      ],
      wordWrap: true,
    });
    for (const p of summary.greedyCoverPicks) {
      greedyTable.push([
        String(p.pick),
        String(p.cumulativeCoveragePct),
        String(p.newlyCoveredNodes),
        String(p.blastRadius),
        String(p.blastRank),
        p.filePath,
        `${p.line}:${p.column}`,
        p.sourceKind,
        p.name,
      ]);
    }
    console.log(greedyTable.toString());
  }

  console.log("");
  console.log(pc.bold("By blast radius"));
  const table = new Table({
    head: [
      pc.dim("Rank"),
      pc.dim("Blast"),
      pc.dim("File"),
      pc.dim("Line:Col"),
      pc.dim("Kind"),
      pc.dim("Name"),
    ],
    wordWrap: true,
  });

  for (const s of summary.sourcesRankedByBlast) {
    table.push([
      String(s.rank),
      String(s.blastRadius),
      s.filePath,
      `${s.line}:${s.column}`,
      s.sourceKind,
      s.name,
    ]);
  }

  console.log(table.toString());
}
