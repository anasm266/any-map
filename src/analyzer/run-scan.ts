import type { ScanSummary } from "../types.js";
import { findAnySources } from "./classify-any-sources.js";
import {
  countProjectSourceFiles,
  createProgramForDirectory,
  resolveScanRoot,
} from "./load-project.js";

export interface ScanOptions {
  targetPath: string;
  json?: boolean;
}

/**
 * Milestone m2: classify all six `any` source kinds (PLAN §4) for a project snapshot.
 */
export function classifyScan(options: ScanOptions): ScanSummary {
  const root = resolveScanRoot(options.targetPath);
  const program = createProgramForDirectory(root);
  return {
    sources: findAnySources(program, root),
    fileCount: countProjectSourceFiles(program),
  };
}
