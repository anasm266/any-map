import { describe, expect, it } from "vitest";
import { evaluateScanFailure } from "../../src/commands/scan-failure.js";
import type { GreedyCoverPick, ScanSummary } from "../../src/types.js";

function minimalSummary(overrides: Partial<ScanSummary>): ScanSummary {
  const base: ScanSummary = {
    sources: [],
    fileCount: 1,
    infectedNodeCount: 0,
    greedyCoverPicks: [],
    sourcesRankedByBlast: [],
  };
  return { ...base, ...overrides };
}

describe("evaluateScanFailure", () => {
  it("fails when source count exceeds fail-above", () => {
    const s = minimalSummary({
      sources: [{ filePath: "a.ts", line: 1, column: 1, name: "x", sourceKind: "explicit-any" }],
    });
    expect(evaluateScanFailure(s, { failAbove: 0 }).failed).toBe(true);
    expect(evaluateScanFailure(s, { failAbove: 1 }).failed).toBe(false);
  });

  it("fails when top-3 greedy coverage is below threshold", () => {
    const picks: GreedyCoverPick[] = [
      {
        pick: 1,
        graphNodeId: "a",
        filePath: "a.ts",
        line: 1,
        column: 1,
        name: "x",
        sourceKind: "explicit-any",
        blastRadius: 2,
        blastRank: 1,
        newlyCoveredNodes: 2,
        cumulativeCoveredNodes: 2,
        cumulativeCoveragePct: 40,
      },
      {
        pick: 2,
        graphNodeId: "b",
        filePath: "b.ts",
        line: 1,
        column: 1,
        name: "y",
        sourceKind: "explicit-any",
        blastRadius: 2,
        blastRank: 2,
        newlyCoveredNodes: 2,
        cumulativeCoveredNodes: 4,
        cumulativeCoveragePct: 50,
      },
    ];
    const s = minimalSummary({ greedyCoverPicks: picks });
    expect(evaluateScanFailure(s, { failCoveragePct: 90 }).failed).toBe(true);
    expect(evaluateScanFailure(s, { failCoveragePct: 40 }).failed).toBe(false);
  });
});
