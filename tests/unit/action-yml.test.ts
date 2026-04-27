import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const actionYmlPath = path.join(
  __dirname,
  "../../.github/actions/any-map-scan/action.yml",
);

describe("composite action wiring", () => {
  it("supports both scan and diff invocation paths", () => {
    const actionYml = fs.readFileSync(actionYmlPath, "utf8");

    expect(actionYml).toContain("command:");
    expect(actionYml).toContain('default: "scan"');
    expect(actionYml).toContain("base-ref:");
    expect(actionYml).toContain("head-ref:");
    expect(actionYml).toContain(
      'npx --yes any-map@${{ inputs.version }} scan "${{ inputs.path }}" ${{ inputs.args }}',
    );
    expect(actionYml).toContain(
      'npx --yes any-map@${{ inputs.version }} diff "${{ inputs.base-ref }}" "${{ inputs.head-ref }}" "${{ inputs.path }}" ${{ inputs.args }}',
    );
  });
});
