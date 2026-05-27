# Migrating to any-map 2.0

## JSON reports

`any-map scan --format json` and `any-map diff --format json` default to **report version 2**:

```json
{
  "reportVersion": 2,
  "summary": { "sources": [], "fileCount": 0, "infectedNodeCount": 0 },
  "rankings": { "greedyCoverPicks": [], "sourcesRankedByBlast": [] },
  "health": { "top3GreedyPct": 100, "medianPairwiseOverlap": 0, ... }
}
```

Diff reports add `meta`, `totals`, and `diff.addedSources` / `removedSources` / `blastChangedSources`.

**Legacy shape:** pass `--report-version 1` for the flat `ScanSummary` / `DiffSummary` object.

## CI flags

| Old               | New                                                                    |
| ----------------- | ---------------------------------------------------------------------- |
| `--fail-coverage` | `--fail-top3-greedy-pct` (deprecated alias still works with a warning) |

For **pull requests**, prefer diff gates instead of repo-wide top-3 coverage:

```bash
any-map diff origin/main HEAD --fail-on-new-sources
```

## SARIF

```bash
any-map scan . --format sarif > any-map.sarif
any-map diff origin/main HEAD --format sarif > any-map-diff.sarif
```

Upload with [GitHub CodeQL SARIF upload](https://github.com/github/codeql-action/tree/main/upload-sarif) or your platform’s SARIF importer.

## GitHub Action

Pin `version: "2"` and use `command: diff` for PRs:

```yaml
- uses: anasm266/any-map/.github/actions/any-map-scan@main
  with:
    command: diff
    base-ref: ${{ github.event.pull_request.base.sha }}
    head-ref: ${{ github.event.pull_request.head.sha }}
    fail-on-new-sources: "true"
    post-summary: "true"
```

## Library exports

`ScanHealth`, `computeScanHealth`, report helpers, and diff failure utilities are exported from `any-map` (see `src/index.ts`).

## Cache

`any-map diff` writes scan summaries under `.any-map-cache/` in the repository root (keyed by commit + scan options). Add `.any-map-cache/` to `.gitignore`. Disable with `--no-cache`.
