# Draft: Greedy set-cover over `any` infection (m5)

When several `any` sources overlap downstream, fixing them in **blast-rank** order (largest infected set first) is easy to explain but not always optimal for **clearing the graph quickly**. A standard **greedy set-cover** repeatedly picks the source that covers the most still-uncovered infected nodes. That order can differ from pure blast ranking when overlaps are skewed.

`any-map scan` now prints both: a greedy “fix order” table with cumulative coverage %, and the blast-ranked list. The `trace` command walks backward along type-flow edges from a symbol to each contributing source so fixes can be reasoned about locally.
