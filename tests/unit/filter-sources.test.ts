import { describe, expect, it } from "vitest";
import { filterSources, parseSourceKindsList } from "../../src/analyzer/filter-sources.js";
import type { AnySource } from "../../src/types.js";

describe("filterSources", () => {
  const rows: AnySource[] = [
    {
      filePath: "src/a.ts",
      line: 1,
      column: 1,
      name: "x",
      sourceKind: "explicit-any",
    },
    {
      filePath: "src/b.spec.ts",
      line: 1,
      column: 1,
      name: "y",
      sourceKind: "as-any",
    },
  ];

  it("filters by source kind", () => {
    const out = filterSources(rows, { sourceKinds: ["explicit-any"] });
    expect(out).toHaveLength(1);
    expect(out[0]!.name).toBe("x");
  });

  it("excludes paths matching --ignore globs", () => {
    const out = filterSources(rows, { ignoreGlobs: ["**/*.spec.ts"] });
    expect(out).toHaveLength(1);
    expect(out[0]!.filePath).toBe("src/a.ts");
  });
});

describe("parseSourceKindsList", () => {
  it("parses CSV kinds", () => {
    expect(parseSourceKindsList(" explicit-any , as-any ")).toEqual(["explicit-any", "as-any"]);
  });

  it("rejects unknown kind", () => {
    expect(() => parseSourceKindsList("nope")).toThrow(/Unknown source kind/);
  });
});
