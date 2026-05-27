# Using any-map with type-coverage

These tools complement each other:

| Tool                                                          | Best for                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------- |
| [type-coverage](https://github.com/plantain-00/type-coverage) | Overall % of identifiers that are not `any`; trending strictness    |
| **any-map**                                                   | Where `any` originates, how it spreads, and which fixes matter most |

## Suggested CI layout

1. **Gate on coverage** (repo-wide or per-package):

   ```bash
   npx type-coverage --detail --at-least 95
   ```

2. **Gate on PR regressions** (branch delta):

   ```bash
   npx any-map@2 diff origin/main HEAD --fail-on-new-sources
   ```

3. **Weekly prioritization** (main branch):

   ```bash
   npx any-map@2 scan . --format json > any-map-report.json
   ```

Use the `health.summaryLine` in the JSON report to decide whether greedy “fix order” is actionable on your codebase.
