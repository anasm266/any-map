import { describe, expect, it } from "vitest";
import { GraphBuilder } from "../../src/analyzer/build-graph.js";
import { findAnySources } from "../../src/analyzer/classify-any-sources.js";
import { createProgramForDirectory } from "../../src/analyzer/load-project.js";
import { withTempProject } from "../helpers/temp-project.js";

describe("greedy set-cover (m5)", () => {
  it("last greedy pick reaches 100% cumulative coverage", () => {
    withTempProject(
      {
        "src/index.ts": `export const a: any = 1;\nexport const x = a;\n`,
      },
      (root) => {
        const program = createProgramForDirectory(root);
        const sources = findAnySources(program, root);
        const builder = new GraphBuilder(program, root);
        builder.build();
        builder.applySources(sources);
        builder.propagate();
        const blast = builder.rankSourcesByBlast();
        const picks = builder.greedySetCoverPicks(blast);
        expect(picks.length).toBeGreaterThan(0);
        expect(picks[picks.length - 1]!.cumulativeCoveragePct).toBe(100);
      },
    );
  });

  it("includes every graph source in picks for two-source fixture", () => {
    withTempProject(
      {
        "src/index.ts": `
export const s1: any = 1;
export const s2: any = 2;
const u = s1;
const v = s1;
const w = s2;
void u; void v; void w;
`,
      },
      (root) => {
        const program = createProgramForDirectory(root);
        const sources = findAnySources(program, root);
        const builder = new GraphBuilder(program, root);
        builder.build();
        builder.applySources(sources);
        builder.propagate();
        const blast = builder.rankSourcesByBlast();
        const picks = builder.greedySetCoverPicks(blast);
        expect(picks.map((p) => p.name)).toContain("s1");
        expect(picks.map((p) => p.name)).toContain("s2");
      },
    );
  });
});
