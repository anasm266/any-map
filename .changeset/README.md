# Changesets

This folder contains [changesets](https://github.com/changesets/changesets) for tracking version bumps and changelog entries.

## Adding a changeset

```bash
pnpm changeset
```

Pick `patch` / `minor` / `major`, write a one-line summary, commit the generated `.md` file alongside your code.

## How releases happen

1. PRs merged to `main` accumulate changesets in this folder.
2. The `release.yml` workflow opens (or updates) a "Version Packages" PR that bumps versions and rewrites `CHANGELOG.md`.
3. Merging that PR publishes to npm.
