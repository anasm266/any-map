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

export interface ScanSummary {
  sources: AnySource[];
  fileCount: number;
}
