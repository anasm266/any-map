import { describe, expect, it } from "vitest";
import { toScanReport } from "../../src/format/report-json.js";
import type { ScanSummary } from "../../src/types.js";

const summary: ScanSummary = {
  sources: [],
  fileCount: 2,
  infectedNodeCount: 0,
  greedyCoverPicks: [],
  sourcesRankedByBlast: [],
  health: {
    top3GreedyPct: 100,
    medianPairwiseOverlap: 0,
    setCoverDistinctiveness: "low",
    summaryLine: "test",
  },
};

describe("toScanReport", () => {
  it("v1 returns flat summary", () => {
    expect(toScanReport(summary, 1)).toBe(summary);
  });

  it("v2 nests summary and rankings", () => {
    const r = toScanReport(summary, 2);
    expect(r).toMatchObject({
      reportVersion: 2,
      summary: { fileCount: 2, infectedNodeCount: 0 },
      health: summary.health,
    });
    if ("rankings" in r) {
      expect(r.rankings.greedyCoverPicks).toEqual([]);
    }
  });
});
