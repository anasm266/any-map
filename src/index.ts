export type { AnySource, GreedyCoverPick, ScanSummary, SourceKind, SourceRanked } from "./types.js";
export { buildScanOptions, classifyScan, runFullScan } from "./analyzer/run-scan.js";
export type { FullScanResult, ScanOptions, ScanResult } from "./analyzer/run-scan.js";
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
