/** Classifier output — milestone m2+ (all `any` source kinds). */

export type SourceKind =
  | "explicit-any"
  | "as-any"
  | "untyped-import"
  | "untyped-return"
  | "catch-binding"
  | "implicit-param";

export interface AnySource {
  /** Project-relative POSIX-style path (forward slashes). */
  filePath: string;
  /** 1-based line for the reported name location. */
  line: number;
  /** 1-based column (UTF-16 code units) for the reported name location. */
  column: number;
  /** Best-effort symbol/declaration name for humans. */
  name: string;
  sourceKind: SourceKind;
}

/** Classifier row + graph metrics (m4). */
export interface SourceRanked extends AnySource {
  rank: number;
  blastRadius: number;
  graphNodeId: string;
}

/** One step of the greedy set-cover over infected graph nodes (m5). */
export interface GreedyCoverPick {
  pick: number;
  graphNodeId: string;
  filePath: string;
  line: number;
  column: number;
  name: string;
  sourceKind: SourceKind;
  blastRadius: number;
  blastRank: number;
  newlyCoveredNodes: number;
  cumulativeCoveredNodes: number;
  /** Rounded percent of all infected nodes covered after this pick (0–100). */
  cumulativeCoveragePct: number;
}

export interface ScanSummary {
  sources: AnySource[];
  fileCount: number;
  /** Graph nodes with at least one `any` infection tag after propagation. */
  infectedNodeCount: number;
  /** Greedy set-cover order: each pick maximizes newly covered infected nodes. */
  greedyCoverPicks: GreedyCoverPick[];
  /** `any` sources with blast radius, sorted descending (intra-module graph reachability). */
  sourcesRankedByBlast: SourceRanked[];
}
