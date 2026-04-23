export type { AnySource, ScanSummary, SourceKind } from "./types.js";
export { classifyScan } from "./analyzer/run-scan.js";
export type { ScanOptions, ScanResult } from "./analyzer/run-scan.js";
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
