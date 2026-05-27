import { describe, expect, it } from "vitest";
import { evaluateDiffFailure } from "../../src/commands/diff-failure.js";
import type { DiffSummary, ScanSummary } from "../../src/types.js";

function emptySummary(): ScanSummary {
  return {
    sources: [],
    fileCount: 1,
    infectedNodeCount: 0,
    greedyCoverPicks: [],
    sourcesRankedByBlast: [],
  };
}

function diff(overrides: Partial<DiffSummary>): DiffSummary {
  const base = emptySummary();
  const after = emptySummary();
  return {
    requestedBaseRef: "base",
    requestedHeadRef: "head",
    effectiveBaseRef: "base",
    effectiveHeadRef: "head",
    compareMode: "merge-base",
    scope: "changed-files",
    changedFiles: ["src/index.ts"],
    before: base,
    after,
    addedSources: [],
    removedSources: [],
    blastChangedSources: [],
    ...overrides,
  };
}

describe("evaluateDiffFailure", () => {
  it("fails on new sources when enabled", () => {
    const result = evaluateDiffFailure(
      diff({
        addedSources: [
          {
            rank: 1,
            blastRadius: 1,
            graphNodeId: "a",
            filePath: "src/a.ts",
            line: 1,
            column: 1,
            name: "x",
            sourceKind: "explicit-any",
          },
        ],
        after: {
          ...emptySummary(),
          sources: [
            {
              filePath: "src/a.ts",
              line: 1,
              column: 1,
              name: "x",
              sourceKind: "explicit-any",
            },
          ],
          infectedNodeCount: 1,
        },
      }),
      { failOnNewSources: true },
    );
    expect(result.failed).toBe(true);
  });

  it("respects max-new-sources", () => {
    const result = evaluateDiffFailure(
      diff({
        addedSources: [
          {
            rank: 1,
            blastRadius: 0,
            graphNodeId: "",
            filePath: "a.ts",
            line: 1,
            column: 1,
            name: "a",
            sourceKind: "explicit-any",
          },
          {
            rank: 2,
            blastRadius: 0,
            graphNodeId: "",
            filePath: "b.ts",
            line: 1,
            column: 1,
            name: "b",
            sourceKind: "explicit-any",
          },
        ],
      }),
      { maxNewSources: 1 },
    );
    expect(result.failed).toBe(true);
  });
});
