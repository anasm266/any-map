# Architecture

How any-map turns a TypeScript project into a ranked list of `any` sources.

## Pipeline

```
tsconfig + sources
      │
      ▼
 Classifier ──▶ Graph builder ──▶ Propagator ──▶ Ranker ──▶ table | json | dot | sarif
```

## Data model

```ts
// NodeId is stable across runs (sha1 of file:line:col:name).
type NodeId = string;

type SourceKind =
  | "explicit-any" // : any, any[], Record<string, any>
  | "as-any" // as any, <any>
  | "untyped-import" // import from a package without types
  | "untyped-return" // return type resolves to any (e.g. JSON.parse)
  | "catch-binding" // catch (e) with no annotation
  | "implicit-param"; // unannotated param in non-strict context

interface AnyNode {
  id: NodeId;
  filePath: string;
  line: number;
  column: number;
  name: string;
  kind: "variable" | "parameter" | "return" | "property" | "import-binding";
  typeString: string;
  isSource: boolean;
  sourceKind?: SourceKind;
  infectedBy: Set<NodeId>; // source ids that flow into this node
}
```

Edges carry a reason (`assignment`, `call-return`, `destructure`, `import`,
`property-access`, `parameter-binding`, `class-member`, `spread`, `type-alias`,
`index-access`) so `trace` can explain each hop. Edges are stored in both
directions: propagation walks forward, trace walks backward.

## Classifier

Walks every source file. For each declaration it asks the checker for the
symbol's type and checks `type.flags & ts.TypeFlags.Any`, then classifies the
source kind from the surrounding syntax. Two gotchas worth knowing about:

- Pass `declaration.name` to `getSymbolAtLocation`, not the declaration itself.
- `type.intrinsicName === "error"` means the checker errored; treat it as
  unknown, not `any`.

## Graph builder

One pass over every node, emitting edges for assignments, call returns,
destructuring, imports/re-exports, property access, class members, spreads,
and returns. Direct intra-project `param ← arg` and `call-return` edges are
followed when TypeScript resolves the callee declaration across files.
Callsite-sensitive analysis through dynamic dispatch or overload/generic
specialization is out of scope.

## Propagator

Forward BFS from every source; each reached node records the source in its
`infectedBy` set. Complexity is `O(|sources| × (|V| + |E|))`, which stays well
under a second for a 10k-symbol project.

## Ranker

Two orderings:

- **Blast radius** — how many nodes each source infects.
- **Greedy set cover** — repeatedly pick the source covering the most
  not-yet-covered infected nodes. This drives the "fix these 3 to remove 80%"
  output. When infection sets barely overlap it converges to the blast-radius
  order, so both are shown.

## Trace

Backward BFS from a target node up incoming edges until sources are reached,
truncated at a max depth (default 10).

## Testing

Fixtures are tiny self-contained TS projects with an `expected.json` listing
ground-truth sources; `tests/eval` compares analyzer output against them. Unit
tests cover classification, edge extraction, propagation, and ranking on
hand-built graphs. Benchmarks run against real repos (zod, zustand, immer, ky)
and feed the README table.
