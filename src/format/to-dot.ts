import { createHash } from "node:crypto";
import type { SerializedGraph } from "../analyzer/graph-types.js";

function escLabel(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
}

function dotName(rawId: string): string {
  return "n_" + createHash("sha256").update(rawId).digest("hex").slice(0, 20);
}

/**
 * Graphviz DOT for an intra-module type-flow snapshot (`--format dot`, `any-map graph`).
 */
export function serializedGraphToDot(
  g: SerializedGraph,
  title = "any-map",
): string {
  const lines: string[] = [
    `digraph "${escLabel(title)}" {`,
    `  rankdir=LR;`,
    `  node [fontname="Helvetica", fontsize=10];`,
    `  edge [fontname="Helvetica", fontsize=8];`,
  ];

  for (const n of g.nodes) {
    const label = `${n.name}\\n${n.filePath}:${n.line}:${n.column}\\n${n.kind}`;
    const shape = n.isSource
      ? `shape=box, style=filled, fillcolor="#ffcccc"`
      : `shape=ellipse`;
    const id = dotName(n.id);
    lines.push(`  ${id} [label="${escLabel(label)}", ${shape}];`);
  }

  const idOf = (raw: string) => dotName(raw);

  for (const e of g.edges) {
    lines.push(
      `  ${idOf(e.from)} -> ${idOf(e.to)} [label="${escLabel(e.reason)}"];`,
    );
  }

  lines.push(`}`);
  return lines.join("\n");
}
