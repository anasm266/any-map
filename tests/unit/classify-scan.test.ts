import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AnySource } from "../../src/types.js";
import { classifyScan } from "../../src/analyzer/run-scan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const smokeRoot = path.join(__dirname, "../fixtures/smoke");

describe("scan smoke (mixed kinds)", () => {
  it("finds explicit `: any` and `as any` separately", () => {
    const summary = classifyScan({ targetPath: smokeRoot });

    expect(summary.fileCount).toBeGreaterThanOrEqual(1);

    const explicit = summary.sources.filter((s) => s.sourceKind === "explicit-any");
    const asAny = summary.sources.filter((s) => s.sourceKind === "as-any");

    expect(explicit).toHaveLength(3);
    expect(asAny).toHaveLength(1);

    const explicitNames = explicit.map((s) => s.name).sort();
    expect(explicitNames).toEqual(["explicit", "returnsAny", "x"].sort());
    expect(asAny[0]?.name).toBe("asserted");
  });

  it("emits stable sorted order (file, line, column, kind)", () => {
    const summary = classifyScan({ targetPath: smokeRoot });
    expect(isSortedLikeClassifier(summary.sources)).toBe(true);
  });

  it("includes every classifier row in sourcesRankedByBlast (blast sort + orphans)", () => {
    const summary = classifyScan({ targetPath: smokeRoot });
    expect(summary.sourcesRankedByBlast).toHaveLength(summary.sources.length);
    const keys = new Set(
      summary.sources.map((s) => `${s.filePath}:${s.line}:${s.column}:${s.name}:${s.sourceKind}`),
    );
    for (const r of summary.sourcesRankedByBlast) {
      const k = `${r.filePath}:${r.line}:${r.column}:${r.name}:${r.sourceKind}`;
      expect(keys.has(k)).toBe(true);
    }
  });

  it("ranks by blast descending among graph-backed sources", () => {
    const summary = classifyScan({ targetPath: smokeRoot });
    const withBlast = summary.sourcesRankedByBlast.filter((r) => r.blastRadius > 0);
    for (let i = 1; i < withBlast.length; i++) {
      expect(withBlast[i - 1]!.blastRadius).toBeGreaterThanOrEqual(withBlast[i]!.blastRadius);
    }
  });

  it("honors --top for sourcesRankedByBlast length", () => {
    const full = classifyScan({ targetPath: smokeRoot });
    const top2 = classifyScan({ targetPath: smokeRoot, top: 2 });
    expect(full.sourcesRankedByBlast.length).toBeGreaterThan(2);
    expect(top2.sourcesRankedByBlast).toHaveLength(2);
    expect(top2.sourcesRankedByBlast[0]?.rank).toBe(1);
    expect(top2.sourcesRankedByBlast[1]?.rank).toBe(2);
  });

  it("reports infected node count and greedy cover picks (m5)", () => {
    const summary = classifyScan({ targetPath: smokeRoot });
    expect(summary.infectedNodeCount).toBeGreaterThan(0);
    expect(summary.greedyCoverPicks.length).toBeGreaterThan(0);
    expect(
      summary.greedyCoverPicks[summary.greedyCoverPicks.length - 1]!.cumulativeCoveragePct,
    ).toBe(100);
  });

  it("filters by sourceKinds (m6)", () => {
    const full = classifyScan({ targetPath: smokeRoot });
    const onlyExplicit = classifyScan({
      targetPath: smokeRoot,
      sourceKinds: ["explicit-any"],
    });
    expect(onlyExplicit.sources.length).toBeLessThan(full.sources.length);
    expect(onlyExplicit.sources.every((s) => s.sourceKind === "explicit-any")).toBe(true);
  });
});

function isSortedLikeClassifier(sources: AnySource[]): boolean {
  for (let i = 1; i < sources.length; i++) {
    const a = sources[i - 1]!;
    const b = sources[i]!;
    if (a.filePath !== b.filePath) {
      if (a.filePath.localeCompare(b.filePath) > 0) return false;
      continue;
    }
    if (a.line !== b.line) {
      if (a.line > b.line) return false;
      continue;
    }
    if (a.column !== b.column) {
      if (a.column > b.column) return false;
      continue;
    }
    if (a.sourceKind.localeCompare(b.sourceKind) > 0) return false;
  }
  return true;
}
