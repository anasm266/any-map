import type { DiffSummary, ScanSummary } from "../types.js";
import { summarizeDiffTotals } from "../analyzer/diff-scan.js";

export type ReportVersion = 1 | 2;

export interface ScanReportV1 extends ScanSummary {}

export interface ScanReportV2 {
  reportVersion: 2;
  health?: ScanSummary["health"];
  summary: {
    sources: ScanSummary["sources"];
    fileCount: number;
    infectedNodeCount: number;
  };
  rankings: {
    greedyCoverPicks: ScanSummary["greedyCoverPicks"];
    sourcesRankedByBlast: ScanSummary["sourcesRankedByBlast"];
  };
}

export interface DiffReportV2 {
  reportVersion: 2;
  meta: Pick<
    DiffSummary,
    | "requestedBaseRef"
    | "requestedHeadRef"
    | "effectiveBaseRef"
    | "effectiveHeadRef"
    | "compareMode"
    | "scope"
    | "changedFiles"
  >;
  health: {
    before?: ScanSummary["health"];
    after?: ScanSummary["health"];
  };
  totals: ReturnType<typeof summarizeDiffTotals>;
  rankings: {
    before: ReturnType<typeof scanRankings>;
    after: ReturnType<typeof scanRankings>;
  };
  diff: {
    addedSources: DiffSummary["addedSources"];
    removedSources: DiffSummary["removedSources"];
    blastChangedSources: DiffSummary["blastChangedSources"];
  };
}

function scanRankings(summary: ScanSummary) {
  return {
    greedyCoverPicks: summary.greedyCoverPicks,
    sourcesRankedByBlast: summary.sourcesRankedByBlast,
  };
}

export function toScanReport(
  summary: ScanSummary,
  version: ReportVersion,
): ScanReportV1 | ScanReportV2 {
  if (version === 1) return summary;
  const report: ScanReportV2 = {
    reportVersion: 2,
    summary: {
      sources: summary.sources,
      fileCount: summary.fileCount,
      infectedNodeCount: summary.infectedNodeCount,
    },
    rankings: scanRankings(summary),
  };
  if (summary.health !== undefined) report.health = summary.health;
  return report;
}

export function toDiffReport(
  summary: DiffSummary,
  version: ReportVersion,
): DiffSummary | DiffReportV2 {
  if (version === 1) return summary;
  const totals = summarizeDiffTotals(summary);
  const report: DiffReportV2 = {
    reportVersion: 2,
    meta: {
      requestedBaseRef: summary.requestedBaseRef,
      requestedHeadRef: summary.requestedHeadRef,
      effectiveBaseRef: summary.effectiveBaseRef,
      effectiveHeadRef: summary.effectiveHeadRef,
      compareMode: summary.compareMode,
      scope: summary.scope,
      changedFiles: summary.changedFiles,
    },
    health: {
      before: summary.before.health,
      after: summary.after.health,
    },
    totals,
    rankings: {
      before: scanRankings(summary.before),
      after: scanRankings(summary.after),
    },
    diff: {
      addedSources: summary.addedSources,
      removedSources: summary.removedSources,
      blastChangedSources: summary.blastChangedSources,
    },
  };
  return report;
}
