import { describe, expect, it } from "vitest";
import { scanSummaryToSarif } from "../../src/format/to-sarif.js";
import type { ScanSummary } from "../../src/types.js";

describe("scanSummaryToSarif", () => {
  it("emits SARIF 2.1 with runs and rules", () => {
    const summary: ScanSummary = {
      sources: [
        {
          filePath: "src/a.ts",
          line: 1,
          column: 5,
          name: "x",
          sourceKind: "explicit-any",
        },
      ],
      fileCount: 1,
      infectedNodeCount: 1,
      greedyCoverPicks: [],
      sourcesRankedByBlast: [
        {
          rank: 1,
          blastRadius: 1,
          graphNodeId: "id",
          filePath: "src/a.ts",
          line: 1,
          column: 5,
          name: "x",
          sourceKind: "explicit-any",
        },
      ],
    };
    const sarif = scanSummaryToSarif(summary) as {
      version: string;
      runs: { tool: { driver: { rules: unknown[] } }; results: unknown[] }[];
    };
    expect(sarif.version).toBe("2.1.0");
    expect(sarif.runs[0]!.tool.driver.rules.length).toBeGreaterThan(0);
    expect(sarif.runs[0]!.results).toHaveLength(1);
  });
});
