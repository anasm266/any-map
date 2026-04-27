# any-map

> Static flow analysis for TypeScript `any` types. Finds the few sources responsible for most of your type erosion.

[![npm version](https://img.shields.io/npm/v/any-map.svg)](https://www.npmjs.com/package/any-map)
[![npm downloads](https://img.shields.io/npm/dm/any-map.svg)](https://www.npmjs.com/package/any-map)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/anasm266/any-map/actions/workflows/ci.yml/badge.svg)](https://github.com/anasm266/any-map/actions/workflows/ci.yml)

TypeScript’s `any` is a silent type-safety killer. Existing tools (`type-coverage`, ESLint’s `no-explicit-any`, `tsc --noImplicitAny`) tell you **where** `any` exists — few tell you where it **originates**, how far it **spreads**, or which **few fixes** would do the most good.

A single `any` in a utility can propagate through assignments, destructuring, and function returns, turning many downstream symbols into untyped code. `any-map` models the project as a directed graph of type-flow, traces `any` from sources to **infected** graph nodes, and ranks fix order with **blast radius** and a **greedy set-cover** pass.

## Status

**Published on npm:** [`any-map`](https://www.npmjs.com/package/any-map) (see `package.json` for current version). Algorithm details and design notes: [PLAN.md](./PLAN.md).

**Recent usage:** `235` npm downloads from `2026-03-27` through `2026-04-25`.

## What it does

| Command                      | Purpose                                                                                |
| ---------------------------- | -------------------------------------------------------------------------------------- |
| `any-map scan [path]`        | Analyze a TS project; table / JSON / DOT; filters + CI thresholds.                     |
| `any-map trace <loc> [path]` | Print type-flow paths from each `any` source to the symbol at `loc` (`file:line:col`). |
| `any-map graph [path]`       | Emit the intra-module type-flow graph as Graphviz DOT (`-o out.dot` or stdout).        |

`any-map scan`: `--format table|json|dot` (or legacy `--json`), `--dump-graph` (JSON graph snapshot), `--top N` (limits **both** the greedy fix-order table and the blast-ranked table, and the matching JSON arrays; `--fail-coverage` still uses the full greedy run), `--source-kinds`, `--ignore` (comma-separated picomatch globs), `--fail-above N`, `--fail-coverage P` (cumulative % from the greedy run must be ≥ P — see [PLAN.md](./PLAN.md) for edge cases). CI: [.github/actions/any-map-scan/action.yml](.github/actions/any-map-scan/action.yml) (`npx any-map@… scan . ${{ inputs.args }}`).

### `allowJs` / JavaScript

Inference-only kinds (`implicit-param`, `untyped-return`, `untyped-import`, `catch-binding`) are **not** reported for plain `.js`/`.jsx`/`.mjs`/`.cjs` where TypeScript often infers `any` without the developer “choosing” it — so source counts and set-cover stay meaningful on mixed TS/JS repos. Written `any` and other non–inference-only classifiers still apply where applicable.

## Real-world benchmarks (how to read them)

| Repo                                                  | Project files | `any` sources | Infected nodes | Top blast\* | Top-3 greedy cum. % |
| ----------------------------------------------------- | ------------- | ------------- | -------------- | ----------- | ------------------- |
| [typeorm/typeorm](https://github.com/typeorm/typeorm) | 3,336         | 1,460         | 908            | 80          | **16%**             |
| [knex/knex](https://github.com/knex/knex)             | 142           | 12            | 2              | 2           | **100%**            |

\*Highest blast-radius among ranked sources (tie broken by sort order). TypeORM: clone, `pnpm install`, default `tsconfig`, then `any-map scan`. Knex is mostly JavaScript, so the **origin** set stays small by design; inference-only `any` on `.js` is not treated as a first-class “source” in the same way as in TS-heavy trees.

**Takeaway:** On a large, entangled ORM-size codebase, **a few “best” sources do not necessarily clear most infection** under greedy set-cover. Overlap and long tails dominate: top-3 cumulative coverage on TypeORM in this run is **16%** of infected nodes, not a marketing “80% with three fixes.” On a small, TS-light library like Knex, the same algorithm can look like “three fixes cover everything” because the graph and source count are tiny.

**Implication:** “Fixing these 3 any sources would restore type safety for 80% of your infected code” is a **storybook** example. Real repos may need a **long list of small fixes** or a different policy (e.g. blast-radius-first sprints, module-by-module hardening). A future version may surface an **overlap / set-cover health** line so you can see up front whether your repo “rewards” a few high-impact fixes. Until then, treat **blast** and **greedy** as **two different lenses**, not a single magic number.

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

(Tables match a real run. Install dependencies in the TypeORM clone before scanning.)

## How it works

1. **Classify** every `any` source (explicit `: any`, `as any`, untyped imports, untyped returns, `catch (e)`, implicit params — see [PLAN.md](./PLAN.md)).
2. **Build** a directed graph where each edge represents type flow (`const a = b` → `b` → `a`, intra-module).
3. **Propagate** from each source with forward BFS; nodes track `infectedBy` source ids.
4. **Rank** by blast radius; run **greedy set-cover** over infected nodes for fix order and cumulative %.
5. **Emit** table, JSON, or DOT.

Details: [PLAN.md §5](./PLAN.md#5-algorithms).

## Why not only type-coverage / ESLint?

| Tool                                 | What it tells you                     | What any-map adds                    |
| ------------------------------------ | ------------------------------------- | ------------------------------------ |
| `tsc --noImplicitAny`                | Where `any` is inferred               | —                                    |
| `@typescript-eslint/no-explicit-any` | Where `any` is written                | —                                    |
| `type-coverage`                      | % of typed identifiers                | —                                    |
| **any-map**                          | Source → infection graph, blast, rank | Propagation + greedy order + `trace` |

## Changelog and design

[CHANGELOG.md](./CHANGELOG.md) · [PLAN.md](./PLAN.md) (algorithms, scope, test strategy).

## Scope boundaries (v1 non-goals)

- No full inference through generics / conditionals / distributive types (surface at usage only).
- Cross-module `param ← arg` uses **declared** parameter types, not interprocedural dataflow.
- No auto-fix, no LSP, no git history — see [PLAN.md §9](./PLAN.md#9-scope-boundaries-non-goals-for-v1).

**Future direction (post–v1 scope):** an export/callsite index could connect argument expressions to parameters for cross-module flow when types align (overloads and generics need care).

## Maintainer / release notes

- **NPM on CI:** [`.github/workflows/release.yml`](.github/workflows/release.yml) needs an [`NPM_TOKEN`](https://docs.npmjs.com/trusted-publishers) repository secret, or the workflow fails on push. Local publish still works.
- **Releases:** tag and GitHub Release should match the version published to npm (see the release workflow).

## Development

```bash
pnpm install
pnpm build
pnpm test
pnpm lint
```

[CONTRIBUTING.md](./CONTRIBUTING.md)

## License

[MIT](./LICENSE)
