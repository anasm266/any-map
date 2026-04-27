import { describe, expect, it } from "vitest";
import { buildSerializedGraph } from "../../src/analyzer/build-graph.js";
import type { SerializedGraph } from "../../src/analyzer/graph-types.js";
import { createProgramForDirectory } from "../../src/analyzer/load-project.js";
import { findAnySources } from "../../src/analyzer/classify-any-sources.js";
import { withTempProject } from "../helpers/temp-project.js";

function hasEdge(
  g: SerializedGraph,
  reason: SerializedGraph["edges"][number]["reason"],
  fromName: string,
  toName: string,
): boolean {
  const idOf = (name: string) => g.nodes.find((n) => n.name === name)?.id;
  const from = idOf(fromName);
  const to = idOf(toName);
  if (!from || !to) return false;
  return g.edges.some(
    (e) => e.from === from && e.to === to && e.reason === reason,
  );
}

function graphFor(files: Record<string, string>): SerializedGraph {
  let out!: SerializedGraph;
  withTempProject(files, (root) => {
    const program = createProgramForDirectory(root);
    const sources = findAnySources(program, root);
    out = buildSerializedGraph(program, root, sources);
  });
  return out;
}

describe("intra-module graph (m3)", () => {
  it("assignment: const a = b → edge b → a", () => {
    const g = graphFor({
      "src/index.ts": `const rhs = 1;\nconst lhs = rhs;\n`,
    });
    expect(hasEdge(g, "assignment", "rhs", "lhs")).toBe(true);
  });

  it("call-return: const y = id(1) → return slot → y", () => {
    const g = graphFor({
      "src/index.ts": `function id(n: number): number { return n; }\nconst y = id(1);\n`,
    });
    const yId = g.nodes.find((n) => n.name === "y")?.id;
    expect(yId).toBeDefined();
    expect(
      g.edges.some((e) => e.reason === "call-return" && e.to === yId),
    ).toBe(true);
  });

  it("call-return: y = id(1) assignment statement → return slot → y", () => {
    const g = graphFor({
      "src/index.ts": `function id(n: number): number { return n; }\nlet y;\ny = id(1);\n`,
    });
    const yId = g.nodes.find((n) => n.name === "y")?.id;
    expect(yId).toBeDefined();
    expect(
      g.edges.some((e) => e.reason === "call-return" && e.to === yId),
    ).toBe(true);
  });

  it("parameter-binding: f(actual) → param formal", () => {
    const g = graphFor({
      "src/index.ts": `function f(formal: number): void { void formal; }\nconst actual = 1;\nf(actual);\n`,
    });
    expect(hasEdge(g, "parameter-binding", "actual", "formal")).toBe(true);
  });

  it("return: return expr → return slot", () => {
    const g = graphFor({
      "src/index.ts": `function g(): number {\n  const inner = 2;\n  return inner;\n}\n`,
    });
    const retNode = g.nodes.find((n) => n.kind === "return" && n.name === "g");
    const innerId = g.nodes.find((n) => n.name === "inner")?.id;
    expect(retNode).toBeDefined();
    expect(innerId).toBeDefined();
    expect(
      g.edges.some(
        (e) =>
          e.from === innerId &&
          e.to === retNode?.id &&
          e.reason === "assignment",
      ),
    ).toBe(true);
  });

  it("destructure: const { x } = obj → obj → x", () => {
    const g = graphFor({
      "src/index.ts": `const obj = { x: 1 };\nconst { x } = obj;\n`,
    });
    expect(hasEdge(g, "destructure", "obj", "x")).toBe(true);
  });

  it("spread: const o = { ...s } → s → o", () => {
    const g = graphFor({
      "src/index.ts": `const spreadSrc = { a: 1 };\nconst merged = { ...spreadSrc };\n`,
    });
    expect(hasEdge(g, "spread", "spreadSrc", "merged")).toBe(true);
  });

  it("class-member: field initializer rhs → field", () => {
    const g = graphFor({
      "src/index.ts": `const seed = 1;\nclass C {\n  field = seed;\n}\n`,
    });
    expect(hasEdge(g, "class-member", "seed", "field")).toBe(true);
  });

  it("import: export id flows to import binding", () => {
    const g = graphFor({
      "src/lib.ts": `export const exported = 1;\n`,
      "src/index.ts": `import { exported as impLoc } from "./lib";\nvoid impLoc;\n`,
    });
    expect(hasEdge(g, "import", "exported", "impLoc")).toBe(true);
  });

  it("default import binding participates in downstream assignment flow", () => {
    const g = graphFor({
      "src/lib.ts": `const exported = 1;\nexport default exported;\n`,
      "src/index.ts": `import imported from "./lib";\nconst local = imported;\n`,
    });
    expect(hasEdge(g, "import", "exported", "imported")).toBe(true);
    expect(hasEdge(g, "assignment", "imported", "local")).toBe(true);
  });

  it("arrow in variable: return uses return slot anchored on binding name", () => {
    const g = graphFor({
      "src/index.ts": `const arrow = (): number => {\n  const v = 3;\n  return v;\n};\n`,
    });
    const ret = g.nodes.find((n) => n.kind === "return" && n.name === "arrow");
    const vId = g.nodes.find((n) => n.name === "v")?.id;
    expect(ret).toBeDefined();
    expect(
      g.edges.some(
        (e) => e.from === vId && e.to === ret?.id && e.reason === "assignment",
      ),
    ).toBe(true);
  });

  it("method call: param binding on class method", () => {
    const g = graphFor({
      "src/index.ts": `class Box {\n  m(p: number): void { void p; }\n}\nconst arg = 1;\nnew Box().m(arg);\n`,
    });
    expect(hasEdge(g, "parameter-binding", "arg", "p")).toBe(true);
  });

  it("chains: assignment + call-return compose", () => {
    const g = graphFor({
      "src/index.ts": `function hop(x: number): number { return x; }\nconst base = 1;\nconst mid = hop(base);\n`,
    });
    expect(hasEdge(g, "parameter-binding", "base", "x")).toBe(true);
    const midId = g.nodes.find((n) => n.name === "mid")?.id;
    expect(
      g.edges.some((e) => e.reason === "call-return" && e.to === midId),
    ).toBe(true);
  });

  it("cross-module parameter-binding uses imported default values as arguments", () => {
    const g = graphFor({
      "src/lib.ts": `const exported = 1;\nexport default exported;\n`,
      "src/consume.ts": `export function consume(formal: number): void { void formal; }\n`,
      "src/index.ts": `import imported from "./lib";\nimport { consume } from "./consume";\nconsume(imported);\n`,
    });
    expect(hasEdge(g, "parameter-binding", "imported", "formal")).toBe(true);
  });
});

describe("propagation + blast (m4)", () => {
  it("tags downstream assignment from an any source", () => {
    const g = graphFor({
      "src/index.ts": `export const src: any = 1;\nexport const downstream = src;\n`,
    });
    const srcNode = g.nodes.find((n) => n.name === "src" && n.isSource);
    const downNode = g.nodes.find((n) => n.name === "downstream");
    expect(srcNode).toBeDefined();
    expect(downNode).toBeDefined();
    expect(downNode?.infectedBy).toContain(srcNode?.id);
  });

  it("source node includes itself in infectedBy", () => {
    const g = graphFor({
      "src/index.ts": `export const only: any = 1;\n`,
    });
    const n = g.nodes.find((x) => x.name === "only" && x.isSource);
    expect(n?.infectedBy).toContain(n?.id);
  });

  it("untyped-return source infects caller binding via return slot + call-return", () => {
    const g = graphFor({
      "src/index.ts": `function f() {\n  return JSON.parse("");\n}\nconst y = f();\n`,
    });
    const ret = g.nodes.find(
      (n) => n.kind === "return" && n.name === "f" && n.isSource,
    );
    const y = g.nodes.find((n) => n.name === "y");
    expect(ret).toBeDefined();
    expect(y).toBeDefined();
    expect(ret?.sourceKind).toBe("untyped-return");
    expect(y?.infectedBy).toContain(ret?.id);
  });

  it("untyped-return infects lhs of y = f() assignment statement", () => {
    const g = graphFor({
      "src/index.ts": `function f() {\n  return JSON.parse("");\n}\nlet y;\ny = f();\n`,
    });
    const ret = g.nodes.find(
      (n) => n.kind === "return" && n.name === "f" && n.isSource,
    );
    const y = g.nodes.find((n) => n.name === "y");
    expect(ret).toBeDefined();
    expect(y?.infectedBy).toContain(ret?.id);
  });

  it("default import bindings keep propagated any infections alive across files", () => {
    const g = graphFor({
      "src/lib.ts": `const exported: any = 1;\nexport default exported;\n`,
      "src/consume.ts": `export function consume(formal: number): void { void formal; }\n`,
      "src/index.ts": `import imported from "./lib";\nimport { consume } from "./consume";\nconsume(imported);\n`,
    });
    const source = g.nodes.find((n) => n.name === "exported" && n.isSource);
    const imported = g.nodes.find((n) => n.name === "imported");
    const formal = g.nodes.find((n) => n.name === "formal");
    expect(source).toBeDefined();
    expect(imported?.infectedBy).toContain(source?.id);
    expect(formal?.infectedBy).toContain(source?.id);
  });
});
