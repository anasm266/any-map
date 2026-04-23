export type { ExplicitAnySource, ScanSummaryM1, SourceKindExplicitM1 } from "./types.js";
export { classifyExplicitAnyScan } from "./analyzer/run-scan-m1.js";
export type { ScanM1Options } from "./analyzer/run-scan-m1.js";
export { createProgramForDirectory, resolveScanRoot } from "./analyzer/load-project.js";
export {
  findExplicitAnySources,
  countProjectSourceFiles,
} from "./analyzer/classify-explicit-any.js";
