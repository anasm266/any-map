import Table from "cli-table3";
import pc from "picocolors";
import type { ScanSummary } from "../types.js";
import { classifyScan, type ScanOptions } from "../analyzer/run-scan.js";

export async function runScanCommand(
  targetPath: string | undefined,
  options: { json?: boolean; dumpGraph?: boolean; top?: number },
): Promise<void> {
  const scanOpts: ScanOptions = { targetPath: targetPath ?? "." };
  if (options.json === true) scanOpts.json = true;
  if (options.dumpGraph === true) scanOpts.dumpGraph = true;
  if (options.top !== undefined) scanOpts.top = options.top;

  const result = classifyScan(scanOpts);

  if (scanOpts.dumpGraph || scanOpts.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  const summary = result as ScanSummary;
  const n = summary.sources.length;
  const files = summary.fileCount;

  console.log(
    pc.bold(
      `Found ${n} any source${n === 1 ? "" : "s"} in ${files} project file${files === 1 ? "" : "s"}.`,
    ),
  );

  if (n === 0) {
    return;
  }

  console.log("");
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
