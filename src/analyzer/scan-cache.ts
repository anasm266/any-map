import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { ScanSummary } from "../types.js";

const CACHE_DIR = ".any-map-cache";

function cacheRoot(repoRoot: string): string {
  return path.join(repoRoot, CACHE_DIR);
}

function cacheKey(
  commit: string,
  scanRoot: string,
  sourceKinds?: string[],
  ignoreGlobs?: string[],
): string {
  const payload = JSON.stringify({
    commit,
    scanRoot: path.resolve(scanRoot),
    sourceKinds: sourceKinds ?? [],
    ignoreGlobs: ignoreGlobs ?? [],
  });
  return crypto.createHash("sha256").update(payload).digest("hex");
}

function cachePath(repoRoot: string, key: string): string {
  return path.join(cacheRoot(repoRoot), `${key}.json`);
}

export function readScanCache(
  repoRoot: string,
  commit: string,
  scanRoot: string,
  sourceKinds?: string[],
  ignoreGlobs?: string[],
): ScanSummary | undefined {
  const file = cachePath(
    repoRoot,
    cacheKey(commit, scanRoot, sourceKinds, ignoreGlobs),
  );
  if (!fs.existsSync(file)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as ScanSummary;
  } catch {
    return undefined;
  }
}

export function writeScanCache(
  repoRoot: string,
  commit: string,
  scanRoot: string,
  summary: ScanSummary,
  sourceKinds?: string[],
  ignoreGlobs?: string[],
): void {
  const dir = cacheRoot(repoRoot);
  fs.mkdirSync(dir, { recursive: true });
  const file = cachePath(
    repoRoot,
    cacheKey(commit, scanRoot, sourceKinds, ignoreGlobs),
  );
  fs.writeFileSync(file, JSON.stringify(summary), "utf8");
}
