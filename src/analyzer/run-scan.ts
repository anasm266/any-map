import type { AnySource, ScanSummary, SourceRanked } from "../types.js";
import { GraphBuilder } from "./build-graph.js";
import type { SourceFilters } from "./filter-sources.js";
import { filterSources } from "./filter-sources.js";
import { findAnySources } from "./classify-any-sources.js";
import type { SerializedGraph } from "./graph-types.js";
import {
  countProjectSourceFiles,
  createProgramForDirectory,
  resolveScanRoot,
} from "./load-project.js";

export interface ScanOptions extends SourceFilters {
  targetPath: string;
  json?: boolean;
  dumpGraph?: boolean;
  /** Limit `sourcesRankedByBlast` (and CLI table) to the first N rows after ranking. */
  top?: number;
}

export type ScanResult = ScanSummary | SerializedGraph;

export interface FullScanResult {
  summary: ScanSummary;
  serializedGraph: SerializedGraph;
}

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
 * Single graph build: summary + serialized graph (for DOT / `--dump-graph` / CI).
 */
export function runFullScan(options: ScanOptions): FullScanResult {
  const root = resolveScanRoot(options.targetPath);
  const program = createProgramForDirectory(root);
  let sources = findAnySources(program, root);
  sources = filterSources(sources, options);
  const fileCount = countProjectSourceFiles(program);

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

  const summary: ScanSummary = {
    sources,
    fileCount,
    infectedNodeCount,
    greedyCoverPicks,
    sourcesRankedByBlast: ranked,
  };

  return { summary, serializedGraph: builder.serialize() };
}

/**
 * Classify `any` sources (m2), intra-module graph + propagation + blast ranking (m4), optional graph JSON (m3).
 */
export function classifyScan(options: ScanOptions & { dumpGraph: true }): SerializedGraph;
export function classifyScan(options?: ScanOptions): ScanSummary;
export function classifyScan(options: ScanOptions = { targetPath: "." }): ScanResult {
  if (options.dumpGraph) {
    const { top, ...rest } = options;
    void top;
    return runFullScan(rest).serializedGraph;
  }
  return runFullScan(options).summary;
}
