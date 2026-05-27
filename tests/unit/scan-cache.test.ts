import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  readScanCache,
  writeScanCache,
} from "../../src/analyzer/scan-cache.js";
import type { ScanSummary } from "../../src/types.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("scan cache", () => {
  it("round-trips summary by commit key", () => {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), "any-map-cache-"));
    tmpDirs.push(repo);
    const summary: ScanSummary = {
      sources: [],
      fileCount: 1,
      infectedNodeCount: 0,
      greedyCoverPicks: [],
      sourcesRankedByBlast: [],
    };
    writeScanCache(repo, "abc123", ".", summary);
    const loaded = readScanCache(repo, "abc123", ".");
    expect(loaded).toEqual(summary);
    expect(fs.existsSync(path.join(repo, ".any-map-cache"))).toBe(true);
  });
});
