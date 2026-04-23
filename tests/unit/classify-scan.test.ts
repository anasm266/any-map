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
