import picomatch from "picomatch";
import type { AnySource, SourceKind } from "../types.js";

export interface SourceFilters {
  /** If set, only these classifier kinds are kept. */
  sourceKinds?: SourceKind[];
  /** Picomatch globs (POSIX paths); matching `filePath` rows are dropped. */
  ignoreGlobs?: string[];
}

const ALL_KINDS: SourceKind[] = [
  "explicit-any",
  "as-any",
  "untyped-import",
  "untyped-return",
  "catch-binding",
  "implicit-param",
];

export function parseSourceKindsList(csv: string): SourceKind[] {
  const parts = csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const out: SourceKind[] = [];
  for (const p of parts) {
    if (!ALL_KINDS.includes(p as SourceKind)) {
      throw new Error(`Unknown source kind "${p}". Expected one of: ${ALL_KINDS.join(", ")}`);
    }
    out.push(p as SourceKind);
  }
  return out;
}

export function parseIgnoreGlobsList(csv: string): string[] {
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function filterSources(sources: AnySource[], filters: SourceFilters): AnySource[] {
  let out = sources;
  if (filters.sourceKinds && filters.sourceKinds.length > 0) {
    const set = new Set(filters.sourceKinds);
    out = out.filter((s) => set.has(s.sourceKind));
  }
  if (filters.ignoreGlobs && filters.ignoreGlobs.length > 0) {
    const matchers = filters.ignoreGlobs.map((g) => picomatch(g, { dot: true }));
    out = out.filter((s) => !matchers.some((m) => m(s.filePath)));
  }
  return out;
}
