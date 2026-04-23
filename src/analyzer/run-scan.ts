import type { ScanSummary } from "../types.js";
import { buildSerializedGraph } from "./build-graph.js";
import { findAnySources } from "./classify-any-sources.js";
import type { SerializedGraph } from "./graph-types.js";
import {
  countProjectSourceFiles,
  createProgramForDirectory,
  resolveScanRoot,
} from "./load-project.js";

export interface ScanOptions {
  targetPath: string;
  json?: boolean;
  dumpGraph?: boolean;
}

export type ScanResult = ScanSummary | SerializedGraph;

/**
 * Classify `any` sources (m2) and optionally emit the intra-module type-flow graph (m3).
 */
export function classifyScan(options: ScanOptions & { dumpGraph: true }): SerializedGraph;
export function classifyScan(options?: ScanOptions): ScanSummary;
export function classifyScan(options: ScanOptions = { targetPath: "." }): ScanResult {
  const root = resolveScanRoot(options.targetPath);
  const program = createProgramForDirectory(root);
  const sources = findAnySources(program, root);
  const fileCount = countProjectSourceFiles(program);

  if (options.dumpGraph) {
    return buildSerializedGraph(program, root, sources);
  }

  return { sources, fileCount };
}
