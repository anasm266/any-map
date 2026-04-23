/** Classifier output for milestone m1 (explicit `any` annotations only). */

export type SourceKindExplicitM1 = "explicit-any";

export interface ExplicitAnySource {
  /** Project-relative POSIX-style path (forward slashes). */
  filePath: string;
  /** 1-based line for the reported name location. */
  line: number;
  /** 1-based column (UTF-16 code units) for the reported name location. */
  column: number;
  /** Best-effort symbol/declaration name for humans. */
  name: string;
  sourceKind: SourceKindExplicitM1;
}

export interface ScanSummaryM1 {
  explicitAnySources: ExplicitAnySource[];
  fileCount: number;
}
