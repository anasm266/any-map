import { describe, expect, it } from "vitest";
import { serializedGraphToDot } from "../../src/format/to-dot.js";
import type { SerializedGraph } from "../../src/analyzer/graph-types.js";

describe("serializedGraphToDot", () => {
  it("emits a digraph with nodes and edges", () => {
    const g: SerializedGraph = {
      nodes: [
        {
          id: "id1",
          filePath: "src/x.ts",
          line: 1,
          column: 1,
          name: "a",
          kind: "variable",
          typeString: "any",
          isSource: true,
          sourceKind: "explicit-any",
          infectedBy: ["id1"],
        },
        {
          id: "id2",
          filePath: "src/x.ts",
          line: 2,
          column: 1,
          name: "b",
          kind: "variable",
          typeString: "any",
          isSource: false,
          infectedBy: ["id1"],
        },
      ],
      edges: [{ from: "id1", to: "id2", reason: "assignment" }],
    };
    const dot = serializedGraphToDot(g, "t");
    expect(dot).toContain("digraph");
    expect(dot).toContain("assignment");
    expect(dot).toContain("ffcccc");
    expect(dot).toContain("src/x.ts");
  });
});
