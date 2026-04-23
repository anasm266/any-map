import path from "node:path";
import { GraphBuilder } from "./build-graph.js";
import { findAnySources } from "./classify-any-sources.js";
import type { GraphEdge } from "./graph-types.js";
import {
  createProgramForDirectory,
  resolveScanRoot,
  toProjectRelativePath,
} from "./load-project.js";
import type {
  TracePathSegment,
  TracePathToSource,
  TraceReport,
} from "./trace-types.js";

/**
 * Parse `file:line` or `file:line:column` (column defaults to 1).
 * The file segment may be project-relative; drive letters on Windows use `C:\...` — use `path\file.ts:line:col` without extra colons in the path, or a relative path.
 */
export function parseTraceLocation(loc: string): {
  filePath: string;
  line: number;
  column: number;
} {
  const lastColon = loc.lastIndexOf(":");
  if (lastColon <= 0) {
    throw new Error(
      `Invalid location "${loc}" (expected file:line or file:line:column)`,
    );
  }
  const tail = loc.slice(lastColon + 1);
  if (!/^\d+$/.test(tail)) {
    throw new Error(`Invalid location "${loc}" (line/column must be numeric)`);
  }
  const lastNum = Number.parseInt(tail, 10);
  const rest = loc.slice(0, lastColon);
  const prevColon = rest.lastIndexOf(":");
  if (prevColon === -1) {
    return { filePath: rest, line: lastNum, column: 1 };
  }
  const mid = rest.slice(prevColon + 1);
  if (!/^\d+$/.test(mid)) {
    throw new Error(`Invalid location "${loc}"`);
  }
  return {
    filePath: rest.slice(0, prevColon),
    line: Number.parseInt(mid, 10),
    column: lastNum,
  };
}

function forwardPathEdges(
  edges: GraphEdge[],
  sourceId: string,
  targetId: string,
): GraphEdge[] | undefined {
  if (sourceId === targetId) return [];

  const backward = new Map<string, GraphEdge[]>();
  for (const e of edges) {
    const arr = backward.get(e.to);
    if (arr) arr.push(e);
    else backward.set(e.to, [e]);
  }

  const q: string[] = [targetId];
  const parent = new Map<string, { next: string; edge: GraphEdge }>();
  const seen = new Set<string>([targetId]);

  while (q.length > 0) {
    const cur = q.shift()!;
    if (cur === sourceId) break;
    for (const e of backward.get(cur) ?? []) {
      const from = e.from;
      if (seen.has(from)) continue;
      seen.add(from);
      parent.set(from, { next: cur, edge: e });
      q.push(from);
    }
  }

  if (sourceId !== targetId && !parent.has(sourceId)) return undefined;

  const out: GraphEdge[] = [];
  let x = sourceId;
  while (x !== targetId) {
    const p = parent.get(x);
    if (!p) return undefined;
    out.push(p.edge);
    x = p.next;
  }
  return out;
}

export interface TraceOptions {
  targetPath: string;
  /** `relative/file.ts:line:column` or `file.ts:line` */
  loc: string;
}

export function traceSymbol(options: TraceOptions): TraceReport {
  const root = resolveScanRoot(options.targetPath);
  const { filePath: rawPath, line, column } = parseTraceLocation(options.loc);
  const absCandidate = path.isAbsolute(rawPath)
    ? rawPath
    : path.join(root, rawPath);
  const rel = toProjectRelativePath(path.normalize(absCandidate), root);

  const program = createProgramForDirectory(root);
  const sources = findAnySources(program, root);
  const builder = new GraphBuilder(program, root);
  builder.build();
  builder.applySources(sources);
  builder.propagate();

  const targetId = builder.findNodeIdAtLocation(rel, line, column);
  if (!targetId) {
    throw new Error(
      `No graph node at ${rel}:${line}:${column}. Use an identifier location from \`any-map scan --dump-graph\` (file + line:column of the \`name\` field).`,
    );
  }

  const targetHop = builder.getTraceHop(targetId);
  if (!targetHop) {
    throw new Error(`Internal error: missing node ${targetId}`);
  }

  const edges = builder.getEdges();
  const paths: TracePathToSource[] = [];

  for (const sourceId of builder.listInfectedSourceIds(targetId)) {
    const row = builder.getAnySourceRow(sourceId);
    if (!row) continue;

    const hopEdges = forwardPathEdges(edges, sourceId, targetId);
    if (hopEdges === undefined) continue;

    const segments: TracePathSegment[] = [];
    let x = sourceId;
    for (const e of hopEdges) {
      const fromH = builder.getTraceHop(x);
      const toH = builder.getTraceHop(e.to);
      if (!fromH || !toH) break;
      segments.push({ from: fromH, to: toH, reason: e.reason });
      x = e.to;
    }

    paths.push({
      sourceId,
      filePath: row.filePath,
      line: row.line,
      column: row.column,
      name: row.name,
      sourceKind: row.sourceKind,
      segments,
    });
  }

  paths.sort(
    (a, b) =>
      a.filePath.localeCompare(b.filePath) ||
      a.line - b.line ||
      a.column - b.column ||
      a.name.localeCompare(b.name),
  );

  return {
    targetPath: root,
    loc: options.loc,
    target: targetHop,
    paths,
  };
}
