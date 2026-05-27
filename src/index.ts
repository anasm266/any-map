export type {
  AnySource,
  BlastChangedSource,
  DiffSummary,
  GreedyCoverPick,
  ScanHealth,
  ScanSummary,
  SetCoverDistinctiveness,
  SourceKind,
  SourceRanked,
} from "./types.js";
export { computeScanHealth } from "./analyzer/scan-health.js";
export { readScanCache, writeScanCache } from "./analyzer/scan-cache.js";
export type { CreateProgramOptions } from "./analyzer/load-project.js";
export {
  toScanReport,
  toDiffReport,
  type ReportVersion,
  type ScanReportV2,
  type DiffReportV2,
} from "./format/report-json.js";
export {
  scanSummaryToSarif,
  diffSummaryToSarif,
  setSarifToolVersion,
} from "./format/to-sarif.js";
export {
  evaluateDiffFailure,
  type DiffFailureOptions,
} from "./commands/diff-failure.js";
export {
  applyTopToScanSummary,
  buildScanOptions,
  classifyScan,
  runFullScan,
} from "./analyzer/run-scan.js";
export {
  applyTopToDiffSummary,
  diffScan,
  summarizeDiffTotals,
} from "./analyzer/diff-scan.js";
export type {
  FullScanResult,
  ScanOptions,
  ScanResult,
} from "./analyzer/run-scan.js";
export type { DiffScanOptions } from "./analyzer/diff-scan.js";
export {
  filterSources,
  parseIgnoreGlobsList,
  parseSourceKindsList,
} from "./analyzer/filter-sources.js";
export type { SourceFilters } from "./analyzer/filter-sources.js";
export { serializedGraphToDot } from "./format/to-dot.js";
export {
  createProgramForDirectory,
  resolveScanRoot,
  countProjectSourceFiles,
} from "./analyzer/load-project.js";
export { findAnySources } from "./analyzer/classify-any-sources.js";
export { findExplicitAnySources } from "./analyzer/classify-explicit-any.js";
export type {
  EdgeReason,
  GraphEdge,
  GraphNodeKind,
  SerializedGraph,
  SerializedGraphNode,
} from "./analyzer/graph-types.js";
export { GraphBuilder, buildSerializedGraph } from "./analyzer/build-graph.js";
export { makeNodeId } from "./analyzer/node-id.js";
export { parseTraceLocation, traceSymbol } from "./analyzer/trace.js";
export type { TraceOptions } from "./analyzer/trace.js";
export type {
  TraceHop,
  TracePathSegment,
  TracePathToSource,
  TraceReport,
} from "./analyzer/trace-types.js";
