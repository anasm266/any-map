import type { GraphBuilder } from "./build-graph.js";
import type {
  ScanHealth,
  ScanSummary,
  SetCoverDistinctiveness,
} from "../types.js";

export type { ScanHealth, SetCoverDistinctiveness };

const OVERLAP_LOW_THRESHOLD = 0.15;

function top3GreedyPct(summary: ScanSummary): number {
  const picks = summary.greedyCoverPicks;
  if (picks.length === 0) return 100;
  return picks[Math.min(2, picks.length - 1)]!.cumulativeCoveragePct;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  const smaller = a.size <= b.size ? a : b;
  const larger = a.size <= b.size ? b : a;
  for (const id of smaller) {
    if (larger.has(id)) inter++;
  }
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((x, y) => x - y);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function buildSummaryLine(
  top3: number,
  overlap: number,
  distinctiveness: SetCoverDistinctiveness,
  sourceCount: number,
  infectedCount: number,
): string {
  if (sourceCount === 0) {
    return "No any sources detected.";
  }
  const overlapPct = Math.round(overlap * 100);
  if (distinctiveness === "low") {
    return `Top-3 greedy covers ${top3}% of infected nodes; sources overlap heavily (median Jaccard ${overlapPct}%). Few high-blast fixes may not clear most infection—prefer a long-tail strategy or blast-radius sprints.`;
  }
  return `Top-3 greedy covers ${top3}% of ${infectedCount} infected node(s); median source overlap ${overlapPct}% (${distinctiveness} set-cover signal). Greedy fix order is meaningfully distinct from blast ranking.`;
}

/**
 * Health metrics for interpreting blast vs greedy rankings on this repo.
 */
export function computeScanHealth(
  builder: GraphBuilder,
  summary: ScanSummary,
): ScanHealth {
  const top3 = top3GreedyPct(summary);
  const perSource = builder.getInfectedNodeSetsPerSource();
  const sets = [...perSource.values()];
  const overlaps: number[] = [];
  for (let i = 0; i < sets.length; i++) {
    for (let j = i + 1; j < sets.length; j++) {
      overlaps.push(jaccard(sets[i]!, sets[j]!));
    }
  }
  const medianPairwiseOverlap = median(overlaps);
  const setCoverDistinctiveness: SetCoverDistinctiveness =
    medianPairwiseOverlap < OVERLAP_LOW_THRESHOLD ? "low" : "high";
  const summaryLine = buildSummaryLine(
    top3,
    medianPairwiseOverlap,
    setCoverDistinctiveness,
    summary.sources.length,
    summary.infectedNodeCount,
  );
  return {
    top3GreedyPct: top3,
    medianPairwiseOverlap,
    setCoverDistinctiveness,
    summaryLine,
  };
}
