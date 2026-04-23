import type { ScanSummary } from "../types.js";

export interface ScanFailureOptions {
  failAbove?: number;
  failCoveragePct?: number;
}

export function evaluateScanFailure(
  summary: ScanSummary,
  opts: ScanFailureOptions,
): { failed: boolean; message?: string } {
  if (opts.failAbove !== undefined && summary.sources.length > opts.failAbove) {
    return {
      failed: true,
      message: `any-map scan: ${summary.sources.length} any source(s) exceeds --fail-above ${opts.failAbove}`,
    };
  }
  if (opts.failCoveragePct !== undefined) {
    const picks = summary.greedyCoverPicks;
    const cov =
      picks.length === 0
        ? 100
        : picks[Math.min(2, picks.length - 1)]!.cumulativeCoveragePct;
    if (cov < opts.failCoveragePct) {
      return {
        failed: true,
        message: `any-map scan: top-3 greedy cumulative coverage ${cov}% is below --fail-coverage ${opts.failCoveragePct}%`,
      };
    }
  }
  return { failed: false };
}

export function applyScanFailureResult(result: {
  failed: boolean;
  message?: string;
}): void {
  if (result.failed && result.message) {
    console.error(result.message);
    process.exitCode = 1;
  }
}
