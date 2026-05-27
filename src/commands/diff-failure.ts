import type { DiffSummary } from "../types.js";
import { summarizeDiffTotals } from "../analyzer/diff-scan.js";

export interface DiffFailureOptions {
  failOnNewSources?: boolean;
  failOnInfectedIncrease?: boolean;
  failOnBlastIncrease?: boolean;
  maxNewSources?: number;
}

export function evaluateDiffFailure(
  summary: DiffSummary,
  opts: DiffFailureOptions,
): { failed: boolean; message?: string } {
  const totals = summarizeDiffTotals(summary);
  const newCount = summary.addedSources.length;

  if (opts.maxNewSources !== undefined && newCount > opts.maxNewSources) {
    return {
      failed: true,
      message: `any-map diff: ${newCount} new any source(s) exceeds --max-new-sources ${opts.maxNewSources}`,
    };
  }

  if (opts.failOnNewSources === true && newCount > 0) {
    return {
      failed: true,
      message: `any-map diff: ${newCount} new any source(s) in scope`,
    };
  }

  if (opts.failOnInfectedIncrease === true && totals.infectedNodeDelta > 0) {
    return {
      failed: true,
      message: `any-map diff: infected nodes increased by ${totals.infectedNodeDelta}`,
    };
  }

  if (opts.failOnBlastIncrease === true) {
    const regressions = summary.blastChangedSources.filter(
      (c) => c.deltaBlastRadius > 0,
    );
    if (regressions.length > 0) {
      return {
        failed: true,
        message: `any-map diff: ${regressions.length} source(s) with increased blast radius`,
      };
    }
  }

  return { failed: false };
}

export function applyDiffFailureResult(result: {
  failed: boolean;
  message?: string;
}): void {
  if (result.failed && result.message) {
    console.error(result.message);
    process.exitCode = 1;
  }
}
