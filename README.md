# any-map

> Static flow analysis for TypeScript `any` types. Finds the few sources responsible for most of your type erosion.

[![npm version](https://img.shields.io/npm/v/any-map.svg)](https://www.npmjs.com/package/any-map)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/anasm266/any-map/actions/workflows/ci.yml/badge.svg)](https://github.com/anasm266/any-map/actions/workflows/ci.yml)

TypeScript's `any` is a silent type-safety killer. Existing tools (`type-coverage`, ESLint's `no-explicit-any`, `tsc --noImplicitAny`) tell you **where** `any` exists — none tell you where it **originates**, how far it's **spread**, or which **few fixes** would restore the most type safety.

A single `any` in one utility file can silently propagate through assignments, destructuring, and function returns, turning dozens of downstream functions into untyped code. `any-map` treats the TypeScript codebase as a directed graph of type dependencies, traces every `any` from its origin to every infected downstream symbol, and produces a prioritized fix list plus a visualization:

> "Fixing these 3 any sources would restore type safety for 80% of your infected code."

## Status

Published on npm as **`any-map`**. Roadmap and milestones: [PLAN.md](./PLAN.md).

## What it does (v1)

| Command                      | Purpose                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `any-map scan [path]`        | Analyze a TS project; table / JSON / DOT; filters + CI thresholds (m6).                |
| `any-map trace <loc> [path]` | Print type-flow paths from each `any` source to the symbol at `loc` (`file:line:col`). |
| `any-map graph [path]`       | Emit the intra-module type-flow graph as Graphviz DOT (`-o out.dot` or stdout).        |

`any-map scan`: `--format table|json|dot` (or legacy `--json`), `--dump-graph` (JSON graph snapshot), `--top N` (limits **both** the greedy fix-order table and the blast-ranked table, and the matching JSON arrays; `--fail-coverage` still uses the full greedy run), `--source-kinds`, `--ignore` (comma-separated picomatch globs), `--fail-above N`, `--fail-coverage P` (top-3 greedy cumulative % must be ≥ P). CI: reusable workflow step in [.github/actions/any-map-scan/action.yml](.github/actions/any-map-scan/action.yml) (`npx any-map@… scan . ${{ inputs.args }}`).

### Benchmark (real repos)

| Repo                                                  | Project files | `any` sources | Infected nodes | Top blast\* | Top-3 greedy cum. % |
| ----------------------------------------------------- | ------------- | ------------- | -------------- | ----------- | ------------------- |
| [typeorm/typeorm](https://github.com/typeorm/typeorm) | 3,336         | 1,460         | 908            | 80          | 16%                 |
| [knex/knex](https://github.com/knex/knex)             | 142           | 12            | 2              | 2           | 100%                |

\*Highest blast-radius among ranked sources (tie broken by sort order). TypeORM numbers from a clone with `pnpm install` and default `tsconfig`; Knex is mostly JavaScript, so source count stays small by design (inference-only `any` on `.js` is not treated as an origin).

`any-map trace src/foo.ts:12:5` prints forward hops (`reason` per edge) from each source to the traced binding; use `--json` for machine-readable `TraceReport`.

### Sample CLI output (TypeORM, `--top 10`)

```text
$ any-map scan ./typeorm --top 10
Scanning 3336 project files...
Found 1460 any sources, 908 infected graph nodes.

Fix order (greedy set-cover)
 Pick  Cum.%  +Nodes  Blast  Bl#  File                                              Line:Col   Kind            Name
 1     9      80      80     2    src/util/TreeRepositoryUtils.ts                   70:40      explicit-any    childEntity
 2     13     38      38     25   src/util/ApplyValueTransformers.ts                5:12       untyped-return  transformFrom
 3     16     24      28     41   src/metadata/EntityMetadata.ts                    574:13     explicit-any    ret
 4     17     12      12     42   src/metadata/EntityListenerMetadata.ts            81:5       untyped-return  execute
 5     18     9       9      44   src/driver/postgres/PostgresDriver.ts             486:38     explicit-any    extensionsMetadata
 6     19     5       5      46   src/query-builder/RelationLoader.ts               517:28     explicit-any    value
 7     19     4       4      47   src/driver/cockroachdb/CockroachQueryRunner.ts  3294:23    untyped-return  getSchemaFromKey
 8     19     4       4      49   src/driver/sap/SapQueryRunner.ts                  2846:19    untyped-return  getSchemaFromKey
 9     20     4       4      50   src/driver/sqlserver/SqlServerQueryRunner.ts      3273:23    untyped-return  getSchemaFromKey
 10    20     4       4      51   test/github-issues/4219/shim.ts                   1:5        explicit-any    _Shim

By blast radius
 Rank  Blast  File                                               Line:Col   Kind          Name
 1     80     src/query-builder/SelectQueryBuilder.ts            1764:15    as-any        result
 2     80     src/util/TreeRepositoryUtils.ts                    70:40      explicit-any  childEntity
 3     79     src/entity-manager/MongoEntityManager.ts           1271:9     explicit-any  idMap
 4     79     src/metadata/ColumnMetadata.ts                     917:24     explicit-any  entity
 5     79     src/persistence/tree/NestedSetSubjectExecutor.ts   339:9      explicit-any  parent
 6     79     src/util/TreeRepositoryUtils.ts                    47:9       explicit-any  entity
 7     79     src/util/TreeRepositoryUtils.ts                    86:9       explicit-any  entity
 8     78     src/driver/aurora-mysql/AuroraMysqlDriver.ts       544:28     explicit-any  value
 9     78     src/driver/aurora-postgres/AuroraPostgresDriver.ts 139:28     explicit-any  value
 10    78     src/driver/cockroachdb/CockroachDriver.ts          407:28     explicit-any  value
```

(Tables above are the same data the tool prints; spacing matches the fixed-width layout from a real run. Install dependencies in the TypeORM clone before scanning.)

## How it works

**`allowJs` JavaScript:** inference-only kinds (`implicit-param`, `untyped-return`, `untyped-import`, `catch-binding`) are not reported for plain `.js`/`.jsx`/`.mjs`/`.cjs` inputs, because TypeScript often infers `any` there without the developer “choosing” `any`. That keeps source counts and greedy set-cover meaningful on mixed TS/JS codebases. Explicit written `any` (and other non–inference-only classifiers) still apply where applicable.

1. **Classify** every `any` source (explicit `: any`, `as any`, untyped imports, untyped returns, `catch (e)`, implicit params).
2. **Build** a directed graph where each edge represents type flow (`const a = b` → edge `b → a`).
3. **Propagate** infection via forward BFS from every source.
4. **Rank** sources by blast radius, then compute greedy set-cover for minimal-fix recommendations.
5. **Emit** table / JSON / Graphviz DOT.

Full algorithm details in [PLAN.md §5](./PLAN.md#5-algorithms).

## Why not existing tools?

| Tool                                 | What it tells you                                                                          | What any-map adds                           |
| ------------------------------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------- |
| `tsc --noImplicitAny`                | Every spot where `any` is inferred                                                         | —                                           |
| `@typescript-eslint/no-explicit-any` | Every spot where `any` is written                                                          | —                                           |
| `type-coverage`                      | % of typed identifiers                                                                     | —                                           |
| **any-map**                          | **Which few sources are responsible for the most type erosion, and the shortest fix path** | Graph-based propagation + set-cover ranking |

## Roadmap

- [x] **m2:** all six `any` source kinds; `any-map scan` uses `cli-table3` (or `--json`).
- [x] **m3:** intra-module type-flow graph; `any-map scan --dump-graph` (library: `buildSerializedGraph` / `GraphBuilder`).
- [x] **m4:** forward propagation + blast-radius ranking; `scan --top N`; JSON field `sourcesRankedByBlast` (rank, blast, graph node id).
- [x] **m5:** greedy set-cover table + JSON; `any-map trace`; `scripts/overlap-analysis.mjs` after build.
- [x] **m6:** `--format table|json|dot`, `any-map graph`, `--source-kinds`, `--ignore`, `--fail-above`, `--fail-coverage`, composite GitHub Action.
- [x] v0.1: real-repo benchmark table (TypeORM + Knex) in README; `--top` applies to both scan tables.
- [ ] v1.0: launch blog post, broader benchmarks

Detailed week-by-week milestones in [PLAN.md](./PLAN.md).

## Scope boundaries (v1 non-goals)

- No inference through generics / conditionals / distributive types (surface resolution at usage only).
- Cross-module `param ← arg` tracking uses declared parameter types only.
- No auto-fix.
- No LSP / editor integration.
- Single working-tree snapshot only (no git-history walking).

See [PLAN.md §9](./PLAN.md#9-scope-boundaries-non-goals-for-v1) for rationale.

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

Contributing guidelines: [CONTRIBUTING.md](./CONTRIBUTING.md).

## License

[MIT](./LICENSE) © Anas M.
