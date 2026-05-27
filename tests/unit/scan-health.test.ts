import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyScan } from "../../src/analyzer/run-scan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const overlapFixture = path.join(__dirname, "../fixtures/as-any-basic");

describe("scan health", () => {
  it("attaches health metrics to classifyScan summary", () => {
    const summary = classifyScan({ targetPath: overlapFixture });
    expect(summary.health).toBeDefined();
    expect(summary.health!.top3GreedyPct).toBeGreaterThanOrEqual(0);
    expect(summary.health!.top3GreedyPct).toBeLessThanOrEqual(100);
    expect(summary.health!.medianPairwiseOverlap).toBeGreaterThanOrEqual(0);
    expect(summary.health!.medianPairwiseOverlap).toBeLessThanOrEqual(1);
    expect(["high", "low"]).toContain(summary.health!.setCoverDistinctiveness);
    expect(summary.health!.summaryLine.length).toBeGreaterThan(0);
  });
});
