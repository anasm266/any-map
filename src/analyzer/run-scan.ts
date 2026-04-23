import type { AnySource, ScanSummary, SourceRanked } from "../types.js";
import { GraphBuilder, buildSerializedGraph } from "./build-graph.js";
import { findAnySources } from "./classify-any-sources.js";
import type { SerializedGraph } from "./graph-types.js";
import {
  countProjectSourceFiles,
  createProgramForDirectory,
  resolveScanRoot,
} from "./load-project.js";

export interface ScanOptions {
  targetPath: string;
  json?: boolean;
  dumpGraph?: boolean;
  /** Limit `sourcesRankedByBlast` (and CLI table) to the first N rows after ranking. */
  top?: number;
}

export type ScanResult = ScanSummary | SerializedGraph;

function sourceKey(s: Pick<AnySource, "filePath" | "line" | "column" | "name">): string {
  return `${s.filePath}:${s.line}:${s.column}:${s.name}`;
}

/**
 * Classifier rows that never matched a graph node (e.g. reporting position mismatch) still appear with blast 0.
 */
function mergeRankedWithOrphans(ranked: SourceRanked[], allSources: AnySource[]): SourceRanked[] {
  const keys = new Set(ranked.map(sourceKey));
  const out: SourceRanked[] = ranked.map((r, i) => ({ ...r, rank: i + 1 }));
  let nextRank = out.length + 1;
  const extras = allSources
    .filter((s) => !keys.has(sourceKey(s)))
    .sort(
      (a, b) =>
        a.filePath.localeCompare(b.filePath) ||
        a.line - b.line ||
        a.column - b.column ||
        a.name.localeCompare(b.name),
    );
  for (const s of extras) {
    out.push({
      rank: nextRank++,
      blastRadius: 0,
      graphNodeId: "",
      filePath: s.filePath,
      line: s.line,
      column: s.column,
      name: s.name,
      sourceKind: s.sourceKind,
    });
  }
  return out;
}

/**
 * Classify `any` sources (m2), intra-module graph + propagation + blast ranking (m4), optional graph JSON (m3).
 */
export function classifyScan(options: ScanOptions & { dumpGraph: true }): SerializedGraph;
export function classifyScan(options?: ScanOptions): ScanSummary;
export function classifyScan(options: ScanOptions = { targetPath: "." }): ScanResult {
  const root = resolveScanRoot(options.targetPath);
  const program = createProgramForDirectory(root);
  const sources = findAnySources(program, root);
  const fileCount = countProjectSourceFiles(program);

  if (options.dumpGraph) {
    return buildSerializedGraph(program, root, sources);
  }

  const builder = new GraphBuilder(program, root);
  builder.build();
  builder.applySources(sources);
  builder.propagate();

  const blastRanked = builder.rankSourcesByBlast();
  const infectedNodeCount = builder.getInfectedNodeCount();
  const greedyCoverPicks = builder.greedySetCoverPicks(blastRanked);

  let ranked = mergeRankedWithOrphans(blastRanked, sources);

  if (options.top !== undefined && options.top > 0) {
    ranked = ranked.slice(0, options.top).map((r, i) => ({ ...r, rank: i + 1 }));
  }

  return {
    sources,
    fileCount,
    infectedNodeCount,
    greedyCoverPicks,
    sourcesRankedByBlast: ranked,
  };
}
