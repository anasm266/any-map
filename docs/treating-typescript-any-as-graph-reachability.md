# Treating TypeScript’s `any` as a graph reachability problem (draft)

## 1. Problem

`any` erases type safety; tools report _where_ `any` appears, not _which origins_ drive most of the damage or how fixes compose.

## 2. Idea

Model the program as a directed graph of type-relevant flows (assignments, call returns, imports, …). Mark classifier-identified `any` **sources**, run forward reachability (BFS), **rank by blast radius**, then **greedy set-cover** over infected nodes to suggest a fix order.

## 3. Bugs we hit on real code (and fixes)

1. **`allowJs` + inference:** Plain `.js` gets `any` from inference, not intent. Treating every binding as a “source” exploded source counts and made greedy useless. **Fix:** skip inference-only kinds on `.js` inputs; keep explicit/syntax findings.
2. **`untyped-return` + graph:** Sources were attached to the function _value_ node, but flow to callers leaves the synthetic **return** node. **Fix:** map `untyped-return` to the `return` slot node.
3. **Call-return:** `const y = f()` had edges; **`y = f()`** did not. **Fix:** handle assignment expressions in expression statements.

## 4. Evidence

- **TypeORM:** ~1.5k sources, ~900 infected nodes, top blasts in the **80s**, top-3 greedy ~**16%** — propagation matters at scale.
- **Knex:** Mostly JS, tiny TS surface — **12** sources, **2** infected, **max blast 2** — the tool reports honestly on “clean” mixed layouts instead of inventing thousands of fake origins.

## 5. Closing

Ship the pipeline; iterate on **more edge kinds** (property reads, richer call patterns) as benchmarks demand.
