# any-map

> Static flow analysis for TypeScript `any` types. Finds the few sources responsible for most of your type erosion.

[![npm version](https://img.shields.io/npm/v/any-map.svg)](https://www.npmjs.com/package/any-map)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![CI](https://github.com/anasm266/any-map/actions/workflows/ci.yml/badge.svg)](https://github.com/anasm266/any-map/actions/workflows/ci.yml)

TypeScript's `any` is a silent type-safety killer. Existing tools (`type-coverage`, ESLint's `no-explicit-any`, `tsc --noImplicitAny`) tell you **where** `any` exists — none tell you where it **originates**, how far it's **spread**, or which **few fixes** would restore the most type safety.

A single `any` in one utility file can silently propagate through assignments, destructuring, and function returns, turning dozens of downstream functions into untyped code. `any-map` treats the TypeScript codebase as a directed graph of type dependencies, traces every `any` from its origin to every infected downstream symbol, and produces a prioritized fix list plus a visualization:

> "Fixing these 3 any sources would restore type safety for 80% of your infected code."

## Status

> 🚧 Pre-release. See [PLAN.md](./PLAN.md) for the full v1 roadmap and milestones.

## What it does (v1)

| Command                             | Purpose                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------ |
| `any-map scan [path]`               | Analyze a TS project; rank `any` sources by intra-module blast radius (`--top`, `--json`). |
| `any-map trace <file>:<line>:<col>` | Trace a specific infected symbol back to contributing sources.                             |
| `any-map graph [--output out.dot]`  | Emit the full infection graph as Graphviz DOT.                                             |

`any-map scan` flags today: `--json` (includes `sourcesRankedByBlast`), `--dump-graph` (nodes, edges, `infectedBy`), `--top <n>` (limit ranked rows).

### Output preview (target for v1)

```text
$ npx any-map scan
Scanning src/ (142 files, 8,421 symbols)...
Found 47 any sources, 312 infected symbols (3.7% of codebase)

TOP SOURCES BY BLAST RADIUS:
┌──────┬─────────────────────────────────────┬──────────┬────────────┬──────────────────┐
│ Rank │ Source                              │ Kind     │ Blast (|)  │ Cumulative fix % │
├──────┼─────────────────────────────────────┼──────────┼────────────┼──────────────────┤
│ 1    │ src/api/client.ts:23:14 `response`  │ as-any   │ 127 (40%)  │ 40%              │
│ 2    │ src/utils/parse.ts:8:31 `parseJson` │ return   │  89 (28%)  │ 66%              │
│ 3    │ src/legacy/index.ts:1:1 `legacy`    │ untyped  │  44 (14%)  │ 80%              │
│ 4    │ src/errors.ts:12:9 `e`              │ catch    │  21 ( 6%)  │ 86%              │
└──────┴─────────────────────────────────────┴──────────┴────────────┴──────────────────┘

FIX RECOMMENDATION:
Address sources #1-3 to eliminate 80% of any infection.
Run `any-map trace src/api/client.ts:23:14` for details on source #1.
```

## How it works

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
- [ ] v0.1 (remaining): greedy set-cover + cumulative coverage in scan output
- [ ] v0.3: greedy set-cover ranking + `trace` command
- [ ] v0.4: `--format dot`, `--fail-above`, GitHub Action
- [ ] v1.0: benchmark table against 4 real repos, blog post, launch

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
