import path from "node:path";
import type {
  BlastChangedSource,
  DiffSummary,
  ScanSummary,
  SourceRanked,
} from "../types.js";
import type { SourceFilters } from "./filter-sources.js";
import {
  listChangedRepoPaths,
  resolveCommit,
  resolveGitWorkspace,
  resolveMergeBase,
  withSnapshotWorktrees,
} from "./git-utils.js";
import {
  applyTopToScanSummary,
  buildScanOptions,
  runFullScan,
} from "./run-scan.js";

export interface DiffScanOptions extends SourceFilters {
  targetPath: string;
  baseRef: string;
  headRef: string;
  top?: number;
}

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
]);

const LOCKFILE_BASENAMES = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
]);

function top3Coverage(summary: ScanSummary): number {
  const picks = summary.greedyCoverPicks;
  return picks.length === 0
    ? 100
    : picks[Math.min(2, picks.length - 1)]!.cumulativeCoveragePct;
}

function sourceKey(
  source: Pick<
    SourceRanked,
    "filePath" | "line" | "column" | "name" | "sourceKind"
  >,
): string {
  return `${source.filePath}:${source.line}:${source.column}:${source.name}:${source.sourceKind}`;
}

function isSourcePath(filePath: string): boolean {
  return SOURCE_EXTENSIONS.has(path.posix.extname(filePath).toLowerCase());
}

function isFallbackTrigger(filePath: string): boolean {
  const basename = path.posix.basename(filePath);
  return (
    filePath.endsWith(".d.ts") ||
    basename === "package.json" ||
    LOCKFILE_BASENAMES.has(basename) ||
    (basename.startsWith("tsconfig") && basename.endsWith(".json"))
  );
}

function toScanRelativePath(
  repoRelativePath: string,
  scanRootRepoRelative: string,
): string {
  if (scanRootRepoRelative.length === 0) return repoRelativePath;
  if (repoRelativePath === scanRootRepoRelative) return "";
  return repoRelativePath.slice(scanRootRepoRelative.length + 1);
}

function filterRankedByFiles(
  summary: ScanSummary,
  changedFiles: Set<string>,
): SourceRanked[] {
  return summary.sourcesRankedByBlast.filter((source) =>
    changedFiles.has(source.filePath),
  );
}

function sortBlastChangedSources(
  changed: BlastChangedSource[],
): BlastChangedSource[] {
  return changed.sort(
    (a, b) =>
      Math.abs(b.deltaBlastRadius) - Math.abs(a.deltaBlastRadius) ||
      b.after.blastRadius - a.after.blastRadius ||
      a.after.filePath.localeCompare(b.after.filePath) ||
      a.after.line - b.after.line ||
      a.after.column - b.after.column ||
      a.after.name.localeCompare(b.after.name),
  );
}

function buildBlastChangedSources(
  beforeSources: SourceRanked[],
  afterSources: SourceRanked[],
): BlastChangedSource[] {
  const beforeByKey = new Map(
    beforeSources.map((source) => [sourceKey(source), source]),
  );
  const changed: BlastChangedSource[] = [];
  for (const afterSource of afterSources) {
    const beforeSource = beforeByKey.get(sourceKey(afterSource));
    if (!beforeSource) continue;
    const deltaBlastRadius = afterSource.blastRadius - beforeSource.blastRadius;
    if (deltaBlastRadius === 0) continue;
    changed.push({
      before: beforeSource,
      after: afterSource,
      deltaBlastRadius,
    });
  }
  return sortBlastChangedSources(changed);
}

function buildAddedSources(
  beforeSources: SourceRanked[],
  afterSources: SourceRanked[],
): SourceRanked[] {
  const beforeKeys = new Set(beforeSources.map(sourceKey));
  return afterSources.filter((source) => !beforeKeys.has(sourceKey(source)));
}

function buildRemovedSources(
  beforeSources: SourceRanked[],
  afterSources: SourceRanked[],
): SourceRanked[] {
  const afterKeys = new Set(afterSources.map(sourceKey));
  return beforeSources.filter((source) => !afterKeys.has(sourceKey(source)));
}

export function applyTopToDiffSummary(
  summary: DiffSummary,
  top?: number,
): DiffSummary {
  if (top === undefined || top <= 0) return summary;
  return {
    ...summary,
    before: applyTopToScanSummary(summary.before, top),
    after: applyTopToScanSummary(summary.after, top),
    addedSources: summary.addedSources.slice(0, top),
    removedSources: summary.removedSources.slice(0, top),
    blastChangedSources: summary.blastChangedSources.slice(0, top),
  };
}

function runFullDiffScan(options: Omit<DiffScanOptions, "top">): DiffSummary {
  const workspace = resolveGitWorkspace(options.targetPath);
  const effectiveHeadRef = resolveCommit(workspace.repoRoot, options.headRef);
  const effectiveBaseRef = resolveMergeBase(
    workspace.repoRoot,
    options.baseRef,
    effectiveHeadRef,
  );

  const changedRepoPaths = listChangedRepoPaths(
    workspace.repoRoot,
    effectiveBaseRef,
    effectiveHeadRef,
    workspace.scanRootRepoRelative,
  );
  const changedFiles = changedRepoPaths.map((repoRelativePath) =>
    toScanRelativePath(repoRelativePath, workspace.scanRootRepoRelative),
  );
  const scope = changedFiles.some(isFallbackTrigger)
    ? "full-project-fallback"
    : "changed-files";

  return withSnapshotWorktrees(
    workspace.repoRoot,
    effectiveBaseRef,
    effectiveHeadRef,
    ({ baseRoot, headRoot }) => {
      const baseTargetPath =
        workspace.scanRootRepoRelative.length === 0
          ? baseRoot
          : path.join(baseRoot, workspace.scanRootRepoRelative);
      const headTargetPath =
        workspace.scanRootRepoRelative.length === 0
          ? headRoot
          : path.join(headRoot, workspace.scanRootRepoRelative);

      const baseScan = runFullScan(
        buildScanOptions(
          baseTargetPath,
          options.sourceKinds,
          options.ignoreGlobs,
        ),
      ).summary;
      const headScan = runFullScan(
        buildScanOptions(
          headTargetPath,
          options.sourceKinds,
          options.ignoreGlobs,
        ),
      ).summary;

      const deltaFiles =
        scope === "full-project-fallback"
          ? undefined
          : new Set(changedFiles.filter(isSourcePath));
      const beforeRelevant =
        deltaFiles === undefined
          ? baseScan.sourcesRankedByBlast
          : filterRankedByFiles(baseScan, deltaFiles);
      const afterRelevant =
        deltaFiles === undefined
          ? headScan.sourcesRankedByBlast
          : filterRankedByFiles(headScan, deltaFiles);

      return {
        requestedBaseRef: options.baseRef,
        requestedHeadRef: options.headRef,
        effectiveBaseRef,
        effectiveHeadRef,
        compareMode: "merge-base",
        scope,
        changedFiles,
        before: baseScan,
        after: headScan,
        addedSources: buildAddedSources(beforeRelevant, afterRelevant),
        removedSources: buildRemovedSources(beforeRelevant, afterRelevant),
        blastChangedSources: buildBlastChangedSources(
          beforeRelevant,
          afterRelevant,
        ),
      };
    },
  );
}

export function diffScan(options: DiffScanOptions): DiffSummary {
  const { top, ...rest } = options;
  return applyTopToDiffSummary(runFullDiffScan(rest), top);
}

export function summarizeDiffTotals(summary: DiffSummary): {
  beforeSourceCount: number;
  afterSourceCount: number;
  sourceDelta: number;
  beforeInfectedNodeCount: number;
  afterInfectedNodeCount: number;
  infectedNodeDelta: number;
  beforeTop3CoveragePct: number;
  afterTop3CoveragePct: number;
  top3CoverageDeltaPct: number;
} {
  const beforeTop3CoveragePct = top3Coverage(summary.before);
  const afterTop3CoveragePct = top3Coverage(summary.after);
  return {
    beforeSourceCount: summary.before.sources.length,
    afterSourceCount: summary.after.sources.length,
    sourceDelta: summary.after.sources.length - summary.before.sources.length,
    beforeInfectedNodeCount: summary.before.infectedNodeCount,
    afterInfectedNodeCount: summary.after.infectedNodeCount,
    infectedNodeDelta:
      summary.after.infectedNodeCount - summary.before.infectedNodeCount,
    beforeTop3CoveragePct,
    afterTop3CoveragePct,
    top3CoverageDeltaPct: afterTop3CoveragePct - beforeTop3CoveragePct,
  };
}
