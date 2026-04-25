# Treating TypeScript’s `any` as a graph reachability problem

## 1. Problem

`any` erases type safety; tools report _where_ `any` appears, not _which origins_ drive most of the damage or how fixes compose.

## 2. Idea

Model the program as a directed graph of type-relevant flows (assignments, call returns, imports, …). Mark classifier-identified `any` **sources**, run forward reachability (BFS), **rank by blast radius** (largest infected set per source), and report a **greedy set-cover** fix order that repeatedly picks the source covering the most still-uncovered infected nodes—the two orderings can differ when sources overlap downstream. `any-map scan` prints both.

## 3. Real-code edge cases (and mitigations)

1. **`allowJs` + inference:** Plain `.js` gets `any` from inference, not intent. Treating every binding as a “source” exploded source counts and made greedy useless. **Fix:** skip inference-only kinds on `.js` inputs; keep explicit/syntax findings.
2. **`untyped-return` + graph:** Sources were attached to the function _value_ node, but flow to callers leaves the synthetic **return** node. **Fix:** map `untyped-return` to the `return` slot node.
3. **Call-return:** `const y = f()` had edges; **`y = f()`** did not. **Fix:** handle assignment expressions in expression statements.

## 4. Evidence

- **TypeORM:** ~1.5k sources, ~900 infected nodes, top blasts in the **80s**, top-3 greedy ~**16%** — propagation matters at scale.
- **Knex:** Mostly JS, tiny TS surface — **12** sources, **2** infected, **max blast 2** — the tool reports honestly on “clean” mixed layouts instead of inventing thousands of fake origins.

## 5. Next steps for the model

Additional edge kinds (property reads, richer call patterns) can be added as benchmarks and reports justify the complexity.
