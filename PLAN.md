# any-map — Detailed build plan

> **Status:** Living document. The CLI, library API, analyzer pipeline, and composite GitHub Action described here are implemented; see [CHANGELOG](./CHANGELOG.md) for version history. §11 lists remaining **v1.0** criteria.

## 0. Summary

A CLI tool that treats a TypeScript project as a directed graph of type-flow relationships, classifies every `any` source, propagates "infection" forward through the graph, and ranks sources by blast radius + greedy set-cover so users know which few fixes restore the most type safety.

**Current package:**

- **`any-map` on npm** — CLI binary plus programmatic API from the **same** package (`import { classifyScan, … } from "any-map"`). There is no separate `any-map/core` package or export path.
- **Reusable GitHub Action** — [`.github/actions/any-map-scan`](./.github/actions/any-map-scan/action.yml) in this repository.

---

## 1. Purpose of this document

This file records architecture, algorithms, scope boundaries, and test/release expectations so behavior stays consistent across contributors and releases.

---

## 2. Tech decisions (locked unless noted)

| Decision           | Choice                                                                         | Why                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Language           | TypeScript 6.0+ (strict)                                                       | TS 6 is current as of Apr 2026.                                                                                         |
| Compiler access    | Raw `typescript` for hot paths, `ts-morph` 28 for ergonomics in tests/fixtures | ts-morph's manipulation overhead is unnecessary for read-only analysis. Use `ts-morph` only where its convenience pays. |
| Runtime target     | **Node 20+** (`package.json` `engines`); CI matrix **20 / 22 / 24** on Ubuntu  | No `.nvmrc` in-repo — use `engines` + CI as the source of truth.                                                        |
| CLI framework      | `commander` 14                                                                 | Mature, small, no surprises.                                                                                            |
| Table output       | `cli-table3` 0.6                                                               | Standard.                                                                                                               |
| Colors             | `picocolors` 1.1                                                               | Smaller than chalk, CJS-safe, dual-format friendly.                                                                     |
| Test runner        | `vitest` 4                                                                     | Fast, TS-native, modern.                                                                                                |
| Bundler            | `tsup` 8                                                                       | Dual ESM+CJS, zero-config, proven. Consider `tsdown` migration in v1.1.                                                 |
| Package manager    | `pnpm` 10                                                                      | Fast, strict, fewer phantom-dep bugs.                                                                                   |
| Release automation | `@changesets/cli` 2.31                                                         | Industry standard; plays well with PR-based flow.                                                                       |
| License            | MIT                                                                            | Standard for OSS dev tools.                                                                                             |

## 3. Architecture overview

```
┌─────────────────────────────────────────────────────────────┐
│                       CLI (commander)                        │
│  scan │ trace <loc> │ graph [--output]                       │
└──────────────────────────┬──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                         Analyzer                             │
│  ┌────────────┐  ┌────────────┐  ┌────────────────────────┐ │
│  │ Project    │→ │ Classifier │→ │ Graph Builder          │ │
│  │ (tsconfig, │  │ (any       │  │ (nodes + edges from    │ │
│  │  files)    │  │  sources)  │  │  type-flow)            │ │
│  └────────────┘  └────────────┘  └────────────┬───────────┘ │
│                                               ▼             │
│               ┌──────────────────────────────────────┐      │
│               │ Propagator (forward BFS from each    │      │
│               │  source; tags infectedBy sets)       │      │
│               └──────────────────┬───────────────────┘      │
│                                  ▼                          │
│               ┌──────────────────────────────────────┐      │
│               │ Ranker (blast radius + greedy set    │      │
│               │  cover over infected nodes)          │      │
│               └──────────────────┬───────────────────┘      │
└──────────────────────────────────┼──────────────────────────┘
                                   ▼
┌─────────────────────────────────────────────────────────────┐
│      Formatters: table │ json │ dot                          │
└─────────────────────────────────────────────────────────────┘
```

## 4. Core data model

```ts
// NodeId is stable across runs (sha1 of file:line:col:name).
type NodeId = string;

type NodeKind =
  | "variable"
  | "parameter"
  | "return"
  | "property"
  | "import-binding";

type SourceKind =
  | "explicit-any" // : any, any[], Record<string, any>, { [k: string]: any }
  | "as-any" // as any, <any>
  | "untyped-import" // import x from 'pkg-without-types' → resolves to any
  | "untyped-return" // function return resolves to any (e.g. JSON.parse)
  | "catch-binding" // catch (e) with no annotation (pre-TS4.4 behavior / useUnknownInCatchVariables=false)
  | "implicit-param"; // param without annotation in non-strict context

interface AnyNode {
  id: NodeId;
  filePath: string; // project-relative
  line: number; // 1-indexed
  column: number; // 1-indexed
  name: string; // symbol name (e.g. "response", "parseJson")
  kind: NodeKind;
  typeString: string; // checker.typeToString(type, { NoTruncation })
  isSource: boolean;
  sourceKind?: SourceKind;
  infectedBy: Set<NodeId>; // source ids that flow into this node
}

interface AnyEdge {
  from: NodeId; // source of type info
  to: NodeId; // consumer of type info
  reason: EdgeReason; // for explain/trace output
}

type EdgeReason =
  | "assignment" // const a = b
  | "call-return" // const a = fn(args)
  | "destructure" // const { x } = obj
  | "import" // named/default import binding
  | "property-access" // a.b
  | "parameter-binding" // f(arg) binds to param(f, 0)
  | "class-member" // class A { m = b }
  | "spread" // { ...a }, [...a]
  | "type-alias" // type T = U
  | "index-access"; // a[k]

interface AnyGraph {
  nodes: Map<NodeId, AnyNode>;
  outgoing: Map<NodeId, AnyEdge[]>;
  incoming: Map<NodeId, AnyEdge[]>;
}
```

Rationale:

- `infectedBy` as a `Set` on every node (not just source→targets map) makes trace queries O(1) and set-cover compute O(n) per source.
- Edges stored both directions for O(1) bidirectional BFS (trace is backward BFS).
- NodeId as sha1-of-location avoids cross-run instability when files change elsewhere.

## 5. Algorithms

### 5.1 Classifier (pass 1)

Walk every source file; for each identifier/declaration:

1. Get `Symbol` via `checker.getSymbolAtLocation(node.name)`. If absent, skip.
2. Get `Type` via `checker.getTypeOfSymbolAtLocation(symbol, useLocation)`.
3. Check `type.flags & ts.TypeFlags.Any`. If set, classify source kind:
   - `: any` annotation node present → `explicit-any`
   - Parent is `AsExpression` with `any` target → `as-any`
   - Declaration is `CatchClause.variableDeclaration` with no type annotation → `catch-binding`
   - Declaration is `ImportClause` / `ImportSpecifier` and resolved module has no ambient/inferred types → `untyped-import`
   - Declaration is a function return and no explicit return annotation → `untyped-return`
   - Declaration is a `Parameter` with no annotation in non-strict tsconfig → `implicit-param`
4. Emit `AnyNode` with `isSource: true`.

Gotchas (from research — TS issues #48313, #48878, #37901):

- Pass `declaration.name` (a `BindingName`), not the declaration itself.
- `PropertyAccessExpression` in type positions can spuriously return `any`. Guard by checking parent node is in a value position.
- `type.intrinsicName === "error"` → checker errored; treat as unknown, not any.

### 5.2 Graph builder (pass 2)

Walk every `Node` once; for each construct, emit edges per the table below:

| Construct               | Edge                                                               |
| ----------------------- | ------------------------------------------------------------------ |
| `const a = b`           | `a ← b`                                                            |
| `const a = fn(args)`    | `a ← returnType(fn)` and `param(fn, i) ← args[i]` if intra-project |
| `const { x } = obj`     | `x ← obj.x`                                                        |
| `import { x } from 'm'` | `x ← export(m, x)`                                                 |
| `class A { m = b }`     | `A.m ← b`                                                          |
| `a.b` property read     | consumer-of(a.b) ← `A.b`                                           |
| `return expr`           | `returnType(enclosingFn) ← expr`                                   |
| spread `{...a}`         | `consumer ← a`                                                     |

For **v1** (per spec): intra-module `param ← arg` tracking. Cross-module `param ← arg` uses declared parameter type only (spec boundary — revisit in v1.1 if user complaints warrant).

### 5.3 Propagator

Forward BFS from every source:

```
for each source s:
    queue = [s]
    while queue not empty:
        u = queue.pop()
        for each edge (u, v) in outgoing[u]:
            if s not in v.infectedBy:
                v.infectedBy.add(s)
                queue.push(v)
```

Complexity: `O(|sources| × (|V| + |E|))`. For a 10k-symbol project with ~500 sources and ~50k edges, ballpark ~25M steps — well under a second in Node.

### 5.4 Ranker

Two outputs:

**a) Blast radius:**
`blast(s) = |{ n : s ∈ n.infectedBy }|`. Simple count per source.

**b) Greedy set cover:**

```
remaining = union of infects(s) for all sources s
ranked = []
while remaining is not empty:
    s* = argmax_s |infects(s) ∩ remaining|
    ranked.append((s*, |infects(s*) ∩ remaining|))
    remaining -= infects(s*)
```

Guaranteed `(1 - 1/e) ≈ 63%` approximation of optimal for the set-cover objective. The "fix these 3 to remove 80%" line uses this ranking cumulatively.

**Overlap heuristic:** On fixture + benchmark repos, if the median overlap coefficient between source–infection sets is <0.15, greedy set-cover ordering is close to blast-radius ordering; still surface both rankings, but interpret “fix order” with that in mind.

### 5.5 Trace

Backward BFS from target node up incoming edges until reaching source nodes. Return all paths (truncate at max depth to bound cost; default 10).

### 5.6 DOT emission

```
digraph AnyMap {
  rankdir=LR;
  node [shape=box, style=filled];
  // red = source, orange = infected, green = clean (optional)
  "nodeId" [label="file:line name", fillcolor="#f88"];
  "nodeId1" -> "nodeId2" [label="assignment"];
}
```

No graphviz deps; emit raw string and let the user pipe through `dot -Tsvg`.

---

## 6. Implementation history

Incremental delivery (classifier → graph → propagation → ranking → trace → formats, filters, CI) is summarized in [CHANGELOG.md](./CHANGELOG.md). This section is intentionally brief; the subsystems above are the source of truth.

---

## 7. Test strategy

### 7.1 Fixtures with labeled ground truth

Each fixture is a tiny self-contained TS project (3–15 files) with:

- `src/*.ts` — the code being analyzed.
- `expected.json` — the ground-truth list of `{ file, line, col, name, sourceKind }` tuples.

Fixtures (minimum for v1):

1. `explicit-any-basic` — 3 files, 4 `: any` cases.
2. `as-any-propagation` — one `as any` in a utility, consumed by 6 call sites.
3. `untyped-import-chain` — `import * as x from './untyped-js-lib'` flowing into 3 consumers.
4. `untyped-return-flow` — `JSON.parse` + `catch (e)` flowing into error reporter.
5. `set-cover-overlap` — 2 sources infecting a shared set + 1 disjoint source; validates set-cover picks the 2 overlapping ones differently than naive rank.
6. `cross-module-intraproject` — 2 files with cross-file param→arg flow.
7. `strict-mode-clean` — a strict project with zero `any`; analyzer should return empty source list (smoke test for false positives).

Evaluation: `tests/eval/recall.test.ts` loads each fixture, runs analyzer, compares against `expected.json`. Target recall ≥95%, precision ≥90% at v1.0.

### 7.2 Unit tests

- `classify.test.ts`: one test per `SourceKind`, pure function tests.
- `graph.test.ts`: edge extraction per construct in §5.2 table.
- `propagate.test.ts`: BFS correctness on hand-built graphs.
- `rank.test.ts`: blast radius + set-cover on hand-built graphs with known optimal covers.

### 7.3 Benchmark repos

Cloned as submodules (or downloaded lazily in a `benchmarks/` script):

- [`expressjs/express`](https://github.com/expressjs/express)
- [`chalk/chalk`](https://github.com/chalk/chalk)
- [`knex/knex`](https://github.com/knex/knex)
- [`vercel/next.js` example starter](https://github.com/vercel/next.js/tree/canary/examples/with-typescript)

Benchmark output: file count, symbol count, any sources found, infected count, top-3 cumulative coverage, wall time, peak memory. Published in README table.

---

## 8. Release engineering

- `.changeset/` for version bumps. Each feature PR includes a changeset.
- `release.yml` workflow:
  1. On push to `main`, if pending changesets → open "Version Packages" PR.
  2. On merge of that PR → publish to npm with `NPM_TOKEN` secret.
- Branch protection on `main`: require CI green and review policy as configured for the repo.
- CI matrix: Node 20, 22, 24 × ubuntu-latest. (Optionally add macos-latest + windows-latest on tagged releases.)
- Semver commitment:
  - `0.x.y` → breaking changes allowed in minor bumps; clear warnings in release notes.
  - `1.0.0` once benchmark numbers are in + ≥10 real users (github issues / npm downloads as proxy).

---

## 9. Scope boundaries (NON-goals for v1)

Copy-paste from spec, reaffirmed:

1. No full inference through generics/conditionals/distributive types. `T extends U ? any : T` treated as surface resolution at usage.
2. No callsite-sensitive cross-module analysis. Cross-module uses declared parameter types.
3. No auto-fix.
4. No LSP / editor integration.
5. No non-TS languages.
6. No historical trend analysis.

v1.1+ backlog (do not touch until v1 ships):

- GitHub Action with PR-diff mode.
- `any-map history --since 6mo` git-walk.
- VS Code codelens.
- `--fix` for deterministic cases (catch→unknown, JSON.parse→zod stub).
- Full cross-module param→arg.
- `any-map diff main HEAD`.

---

## 10. Risk register (update as hit)

| Risk                                  | Likelihood | Mitigation                                                                                                                        |
| ------------------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Set-cover collapses to blast ranking  | Medium     | If overlap metrics show collapse, treat set-cover as a secondary lens; keep blast ranking prominent.                              |
| getTypeAtLocation spurious any        | High       | Guard against `type.intrinsicName === "error"`; add regression test per observed false-positive.                                  |
| Perf blows up on 50k+ symbol repos    | Medium     | Switch infectedBy to bitset; add `--max-files` escape hatch.                                                                      |
| ts-morph version pin drift vs user TS | Medium     | Declare peer dep range; test matrix against TS 5.8 / 5.9 / 6.0.                                                                   |
| Low visibility after release          | Medium     | Clear README benchmarks, prior-art comparison, and actionable CLI output.                                                          |
| Scope creep into v1.1 items           | High       | This file. Re-read §9 before adding any feature.                                                                                  |

---

## 11. Definition of done (v1.0)

- [x] All 6 source kinds detected.
- [x] Graph construction + unit tests for core edges (see `tests/unit/graph-builder.test.ts`; §5.2 is the design target).
- [x] Forward propagation + trace both work end-to-end.
- [x] Blast radius + greedy set-cover ranking both implemented.
- [x] `scan`, `trace`, `graph` commands all functional.
- [x] `--format table|json|dot` works.
- [x] `--fail-above`, `--fail-coverage` CI flags work.
- [x] Fixture recall tests (`tests/eval/fixtures-recall.test.ts`); numeric ≥95% / ≥90% targets remain goals, not hard gates.
- [ ] Benchmark table in README with **≥4** real TS-native repos (currently 2 + smoke fixture).
- [x] Reusable GitHub Action published **in this repo** (`.github/actions/any-map-scan`).

When remaining items are satisfied: tag **`v1.0.0`**.
