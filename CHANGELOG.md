# any-map

## 1.4.0

### Minor Changes

- ef90eb9: Preserve intermediate re-export hops in the flow graph, including named and `export *` chains, and improve explicit `: any` function return propagation into downstream callers.

### Patch Changes

- ef90eb9: Fix `untyped-import` classification so imports from local TypeScript exports that already carry `any` are not double-counted as new import sources.

## 1.3.0

### Minor Changes

- a2a0b32: Add `any-map diff <base> <head>` with merge-base semantics, changed-file delta reporting, reusable GitHub Action support, and programmatic diff APIs.

## 1.2.0

### Minor Changes

- 54f45ec: Improve graph propagation through object property reads, string-literal index reads, and plain assignment statements.

## 1.1.0

### Minor Changes

- f67041c: Improve graph propagation through imported value bindings, including default imports used in assignments and cross-module call arguments.

## 1.0.0

### Major Changes

- Mark the current analyzer, CLI, and GitHub Action as the first stable `1.0.0` release line. This release also fixes CLI version reporting and refreshes the benchmark evidence used to justify the v1 tag.

### Patch Changes

- 0132634: Documentation: remove first-person dev narrative, week-by-week milestones, and similar meta from Markdown; keep technical content only.

## 0.1.1

### Patch Changes

- readme update

## 0.1.0

### Minor Changes

- 871d88c: Intra-module type-flow graph (`GraphBuilder`, `buildSerializedGraph`), `any-map scan --dump-graph`, SHA-1 node ids, 11 graph edge unit tests.
- bb93674: Forward propagation (`infectedBy` on graph nodes), blast-radius ranking, `sourcesRankedByBlast` on scan summary / `--json`, `any-map scan --top <n>`, table columns Rank + Blast.
- 01405fc: Greedy set-cover (`greedyCoverPicks`, `infectedNodeCount` on `ScanSummary`), cumulative coverage in scan table, `any-map trace <loc>`, library APIs `traceSymbol` / `parseTraceLocation`, optional `scripts/overlap-analysis.mjs`.
- e2a934a: `scan --format table|json|dot`, `any-map graph [-o file]`, `--source-kinds` / `--ignore` (picomatch), `--fail-above` / `--fail-coverage`, `runFullScan` + `serializedGraphToDot`, composite action `.github/actions/any-map-scan`.

### Patch Changes

- Apply `--top` to both greedy set-cover and blast-ranked table/JSON slices (CI `--fail-coverage` still uses the full greedy run). Print a short “Scanning …” line before totals. README: real TypeORM `--top 10` sample and benchmark table (TypeORM + Knex).
- e34d9fc: Classify all six `any` source kinds, `cli-table3` scan output, labeled fixtures + recall tests.
