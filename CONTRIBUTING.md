# Contributing to any-map

Thanks for considering a contribution. This project is pre-1.0 and under active development — please open an issue before starting non-trivial work so we can discuss direction.

## Development setup

Requirements:

- Node.js 20+ (22 recommended; see `.nvmrc`)
- pnpm 10+

```bash
pnpm install
pnpm build       # one-off build
pnpm dev         # watch mode
pnpm test        # run test suite
pnpm test:watch  # watch mode for tests
pnpm lint        # eslint
pnpm typecheck   # tsc --noEmit
pnpm format      # prettier
```

## Project layout

```
src/
  analyzer/     # classifier, graph builder, propagator, ranker
  commands/     # scan, trace, graph CLI commands
  formatters/   # table, json, dot output
  cli.ts        # CLI entry
  index.ts      # library entry
tests/
  unit/         # pure function tests
  integration/  # end-to-end against fixtures
  fixtures/     # labeled TS projects + expected.json
benchmarks/     # perf + recall on real OSS repos
```

## Commit conventions

Conventional Commits, with milestone tags matching [PLAN.md](./PLAN.md):

- `feat(m3): intra-module edge extraction`
- `fix(classify): guard against error intrinsic false-positives`
- `test(fixtures): add set-cover-overlap fixture`
- `docs: update benchmark numbers`
- `chore: bump deps`

## Pull requests

1. Open an issue first for non-trivial changes.
2. Add a changeset: `pnpm changeset` (choose patch/minor/major, write a short summary).
3. Ensure CI is green (build, test, lint, typecheck).
4. Link the issue in the PR description.

## Testing new source-kind detection

If you're adding detection for a new TS construct:

1. Add a labeled fixture under `tests/fixtures/<name>/` with an `expected.json`.
2. Add a unit test in `tests/unit/classify.test.ts`.
3. Ensure overall fixture recall stays ≥95% and precision ≥90%.

## Release process

Releases are automated via [changesets](https://github.com/changesets/changesets). Merged PRs accumulate changeset entries; the `release.yml` workflow opens a "Version Packages" PR. Merging that PR publishes to npm.

Maintainers: see `.github/workflows/release.yml`.
