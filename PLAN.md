# any-map — Detailed Build Plan

> **Status:** living document. Update after each milestone.
> **Owner:** @anasm266
> **Target v1.0 release:** ~7 weeks from kickoff.

## 0. Summary

A CLI tool that treats a TypeScript project as a directed graph of type-flow relationships, classifies every `any` source, propagates "infection" forward through the graph, and ranks sources by blast radius + greedy set-cover so users know which few fixes restore the most type safety.

Public artifacts at v1.0:

- `any-map` CLI on npm (ESM + CJS).
- `any-map/core` library export for programmatic use.
- GitHub Action wrapper repo (`anasm266/any-map-action`).
- Blog post: _"Treating TypeScript's `any` as a graph reachability problem."_

---

## 1. Why this plan exists

I've shipped comparable integration projects (typing-race) in days. any-map is a different shape of work: compiler-internals-heavy, edge-case-unbounded, 30-40% dead-reckoning before anything is visible end-to-end. This plan exists to:

1. Force skeleton-first development so I always have a demoable binary.
2. Pre-commit to scope boundaries before hitting them.
3. Name the danger zones per week so I recognize when I'm in one.

---

## 2. Tech decisions (locked unless noted)

| Decision           | Choice                                                                         | Why                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Language           | TypeScript 6.0+ (strict)                                                       | TS 6 is current as of Apr 2026.                                                                                         |
| Compiler access    | Raw `typescript` for hot paths, `ts-morph` 28 for ergonomics in tests/fixtures | ts-morph's manipulation overhead is unnecessary for read-only analysis. Use `ts-morph` only where its convenience pays. |
| Runtime target     | Node 22 LTS (`.nvmrc`), test on Node 20/22/24 in CI                            | 22 is Maintenance LTS; 24 is Active LTS. Covers ~all users.                                                             |
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

type NodeKind = "variable" | "parameter" | "return" | "property" | "import-binding";

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

**Measurement decision (week 3):** compute set-cover divergence from blast-radius ranking on fixture + benchmark repos. If median overlap coefficient between source-infection sets is <0.15, set-cover collapses to blast-ranking and we surface both numbers but lead with blast.

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

## 6. Milestones (week-by-week)

Each milestone ends with a commit tagged `m{N}` and a working binary. If week ends without a working binary, something's wrong.

### Week 1 — m0–m1: Skeleton + single source kind

**Deliverables:**

- `pnpm build` produces `dist/cli.js` that runs.
- `npx any-map scan fixtures/smoke/` prints one hardcoded row.
- `m1`: classifier detects `explicit-any` only. No edges, no propagation. Output: "Found N explicit-any sources in M files" + flat list.
- Published to npm as `0.0.1-alpha`.

**Danger:** sinking hours into ts-morph vs raw compiler API choice. Decision: raw TS compiler API from day 1, ts-morph only for test fixture setup.

**Git milestones:** `feat(m0): scaffold CLI + analyzer shell`, `feat(m1): explicit-any detection`.

### Week 2 — m2: All source kinds classified

**Deliverables:**

- All 6 `SourceKind`s implemented: explicit-any, as-any, untyped-import, untyped-return, catch-binding, implicit-param.
- `tests/fixtures/` has one labeled fixture per kind (see §7).
- `scan` outputs a table (cli-table3) of sources, no blast yet, sorted by file.
- Integration test against `fixtures/` passes ≥95% labeled recall.
- Published `0.0.2`.

**Danger:** untyped-import detection is fuzzy. Narrow v1 definition to "resolved import binding has `type.flags & TypeFlags.Any`" — if the lib ships loose types, we'll catch them; if it ships tight types, we won't falsely flag.

**Git milestones:** `feat(m2): all source kinds classified + fixtures`.

### Week 3 — m3: Graph construction

**Deliverables:**

- Edge extraction for all constructs in §5.2 table (intra-module only).
- `graph.ts` data structure + serialization.
- Debug dump: `any-map scan --dump-graph` writes a JSON adjacency list.
- Unit tests verify 10+ edge extraction cases.
- Published `0.1.0`.

**Danger zone (highest of the project):** the edge-extraction visitor is where the unknown-unknowns live. Re-exports, barrel files, `typeof` imports, namespace re-exports, type-only imports. Write the visitor to **log-and-skip** unknown node kinds rather than crash. Keep a counter: "skipped N nodes of K unique kinds." Triage after week 3.

**Git milestones:** `feat(m3): graph construction (intra-module)`.

### Week 4 — m4: Propagation + blast radius

**Deliverables:**

- Forward BFS propagation working; `AnyNode.infectedBy` populated.
- `scan` output sorted by blast radius descending.
- `--top N` flag.
- Table shows: rank, file:line, source kind, blast count.
- Performance: runs on Express in <5s, on 10k-file project in <30s.
- Published `0.2.0`.

**Danger:** memory. 10k nodes × ~500 sources in infectedBy sets = ~5M set entries = OK. 100k nodes × 2k sources = 200M → not OK. Switch to bitset representation (Uint32Array indexed by sourceIdx) if node count exceeds a threshold.

**Git milestones:** `feat(m4): infection propagation + blast ranking`.

### Week 5 — m5: Set cover + trace

**Deliverables:**

- Greedy set-cover implementation; cumulative coverage % in scan output.
- `any-map trace <file>:<line>:<col>` works; prints path from target back to each contributing source with edge reasons.
- Overlap analysis: one-off script that measures set-cover benefit on real benchmarks (Express, Chalk, Knex, a Next.js starter).
- Blog post draft.
- Published `0.3.0`.

**Danger:** if measurement shows set-cover collapses to blast ranking (overlap <0.15 median), demote set-cover from the headline. Keep the line but lead with blast radius.

**Git milestones:** `feat(m5): set-cover ranking + trace command`.

### Week 6 — m6: Formats + filters + CI integration

**Deliverables:**

- `--format table|json|dot`.
- `any-map graph [--output out.dot]`.
- `--source-kinds`, `--ignore`, `--top`, `--fail-above N`, `--fail-coverage X%` flags.
- `anasm266/any-map-action` wrapper repo with `action.yml` + PR-comment formatter.
- Benchmark numbers in main README (table: repo, files, sources, infected %, top-3 coverage %).
- Published `0.4.0` (RC).

**Git milestones:** `feat(m6): full CLI surface + GH Action + benchmarks`.

### Week 7 — m7: Polish + release

**Deliverables:**

- Docs site (consider just a rich README + GitHub Pages; avoid Docusaurus unless we need it).
- Cross-platform testing (macOS, Ubuntu, Windows) via CI matrix.
- Final README pass: elevator pitch, output example screenshot, install, usage, prior-art-and-differences, FAQ.
- Blog post published (dev.to + personal site).
- HN / r/typescript / r/programming launch.
- Version `1.0.0`.

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
- Branch protection on `main`: require CI green + 1 review (even if solo, self-review via PR enforces hygiene).
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
| Set-cover collapses to blast ranking  | Medium     | Measure in week 5; if collapsed, demote from headline, keep as secondary metric.                                                  |
| getTypeAtLocation spurious any        | High       | Guard against `type.intrinsicName === "error"`; add regression test per observed false-positive.                                  |
| Perf blows up on 50k+ symbol repos    | Medium     | Switch infectedBy to bitset; add `--max-files` escape hatch.                                                                      |
| ts-morph version pin drift vs user TS | Medium     | Declare peer dep range; test matrix against TS 5.8 / 5.9 / 6.0.                                                                   |
| No adoption post-launch               | High       | Blog post + benchmark screenshots + concrete "fix these 3" quotable line; prior-art section in README to sharpen differentiation. |
| Scope creep into v1.1 items           | High       | This file. Re-read §9 before adding any feature.                                                                                  |

---

## 11. Definition of done (v1.0)

- [ ] All 6 source kinds detected.
- [ ] Graph construction passes §5.2 edge table tests.
- [ ] Forward propagation + trace both work end-to-end.
- [ ] Blast radius + set-cover ranking both implemented.
- [ ] `scan`, `trace`, `graph` commands all functional.
- [ ] `--format table|json|dot` works.
- [ ] `--fail-above`, `--fail-coverage` CI flags work.
- [ ] Fixture recall ≥95%, precision ≥90%.
- [ ] Benchmark table in README with ≥4 real repos.
- [ ] GitHub Action wrapper repo published.
- [ ] Blog post published.
- [ ] npm downloads ≥50/week at 2 weeks post-launch (soft signal).

When all checked: tag `v1.0.0`.
