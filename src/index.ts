export type { AnySource, ScanSummary, SourceKind } from "./types.js";
export { classifyScan } from "./analyzer/run-scan.js";
export type { ScanOptions } from "./analyzer/run-scan.js";
export {
  createProgramForDirectory,
  resolveScanRoot,
  countProjectSourceFiles,
} from "./analyzer/load-project.js";
export { findAnySources } from "./analyzer/classify-any-sources.js";
export { findExplicitAnySources } from "./analyzer/classify-explicit-any.js";
