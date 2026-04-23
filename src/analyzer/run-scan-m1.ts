import type { ScanSummaryM1 } from "../types.js";
import { findExplicitAnySources, countProjectSourceFiles } from "./classify-explicit-any.js";
import { createProgramForDirectory, resolveScanRoot } from "./load-project.js";

export interface ScanM1Options {
  targetPath: string;
  json?: boolean;
}

/**
 * Milestone m1: load tsconfig from the scan root, classify explicit `: any` annotations only.
 */
export function classifyExplicitAnyScan(options: ScanM1Options): ScanSummaryM1 {
  const root = resolveScanRoot(options.targetPath);
  const program = createProgramForDirectory(root);
  const explicitAnySources = findExplicitAnySources(program, root);
  const fileCount = countProjectSourceFiles(program);

  return { explicitAnySources, fileCount };
}
