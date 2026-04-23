import { describe, expect, it } from "vitest";
import { findAnySources } from "../../src/analyzer/classify-any-sources.js";
import { createProgramForDirectory } from "../../src/analyzer/load-project.js";
import { withAllowJsTempProject } from "../helpers/temp-project.js";

const INFERENCE_KINDS = new Set([
  "implicit-param",
  "untyped-return",
  "untyped-import",
  "catch-binding",
]);

describe("classify: skip inference-only kinds on plain JS inputs (allowJs)", () => {
  it("does not treat JS inference as any sources (implicit param, return, import, catch)", () => {
    withAllowJsTempProject(
      {
        "src/helper.ts": `export const leak: any = 1;\n`,
        "src/consumer.js": `
import { leak } from "./helper.js";

export function f(x) {
  return x;
}

try {
  f(1);
} catch (e) {
  void e;
}

void leak;
`,
      },
      (root) => {
        const program = createProgramForDirectory(root);
        const sources = findAnySources(program, root);

        const bad = sources.filter(
          (s) => s.filePath.endsWith("consumer.js") && INFERENCE_KINDS.has(s.sourceKind),
        );
        expect(bad).toEqual([]);

        expect(sources.some((s) => s.sourceKind === "explicit-any" && s.name === "leak")).toBe(
          true,
        );
      },
    );
  });
});
