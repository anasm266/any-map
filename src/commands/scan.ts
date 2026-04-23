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
