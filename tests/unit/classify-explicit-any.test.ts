import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { classifyExplicitAnyScan } from "../../src/analyzer/run-scan-m1.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const smokeRoot = path.join(__dirname, "../fixtures/smoke");

describe("m1 explicit-any classifier", () => {
  it("finds explicit : any annotations and ignores `as any`", () => {
    const summary = classifyExplicitAnyScan({ targetPath: smokeRoot });

    expect(summary.fileCount).toBeGreaterThanOrEqual(1);
    expect(summary.explicitAnySources).toHaveLength(3);

    const names = summary.explicitAnySources.map((s) => s.name).sort();
    // Parameter annotations report the binding name (`x`), not the function name.
    expect(names).toEqual(["explicit", "returnsAny", "x"].sort());
  });

  it("emits stable sorted order", () => {
    const summary = classifyExplicitAnyScan({ targetPath: smokeRoot });
    const lines = summary.explicitAnySources.map((s) => s.line);
    const sorted = [...lines].sort((a, b) => a - b);
    expect(lines).toEqual(sorted);
  });
});
