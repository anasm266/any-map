import { describe, expect, it } from "vitest";
import { parseTraceLocation, traceSymbol } from "../../src/analyzer/trace.js";
import { withTempProject } from "../helpers/temp-project.js";

describe("parseTraceLocation", () => {
  it("parses file:line:column", () => {
    expect(parseTraceLocation("src/a.ts:10:5")).toEqual({
      filePath: "src/a.ts",
      line: 10,
      column: 5,
    });
  });

  it("parses file:line with column 1", () => {
    expect(parseTraceLocation("src/a.ts:10")).toEqual({
      filePath: "src/a.ts",
      line: 10,
      column: 1,
    });
  });
});

describe("traceSymbol", () => {
  it("traces assignment chain from downstream binding to any source", () => {
    withTempProject(
      {
        "src/index.ts": `export const src: any = 1;
export const downstream = src;
`,
      },
      (root) => {
        const report = traceSymbol({
          targetPath: root,
          loc: "src/index.ts:2:14",
        });

        expect(report.target.name).toBe("downstream");
        expect(report.paths.length).toBeGreaterThanOrEqual(1);
        const p = report.paths.find((x) => x.name === "src");
        expect(p).toBeDefined();
        expect(p!.segments.length).toBeGreaterThanOrEqual(1);
        expect(p!.segments.some((s) => s.reason === "assignment")).toBe(true);
      },
    );
  });
});
