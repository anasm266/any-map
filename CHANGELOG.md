# any-map

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
