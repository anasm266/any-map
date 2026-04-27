import { describe, expect, it } from "vitest";
import { findAnySources } from "../../src/analyzer/classify-any-sources.js";
import { createProgramForDirectory } from "../../src/analyzer/load-project.js";
import {
  withAllowJsTempProject,
  withTempProject,
} from "../helpers/temp-project.js";

describe("classify: untyped-import accuracy", () => {
  it("does not label imports from local TS any exports as untyped-import", () => {
    withTempProject(
      {
        "src/lib.ts": `export const leaked: any = 1;\n`,
        "src/index.ts": `import { leaked } from "./lib";\nexport const downstream = leaked;\n`,
      },
      (root) => {
        const program = createProgramForDirectory(root);
        const sources = findAnySources(program, root);

        expect(
          sources.filter((source) => source.sourceKind === "untyped-import"),
        ).toEqual([]);
        expect(
          sources.filter((source) => source.sourceKind === "explicit-any"),
        ).toHaveLength(1);
      },
    );
  });

  it("still labels imports from local JS modules as untyped-import", () => {
    withAllowJsTempProject(
      {
        "src/lib.js": `export const leaked = JSON.parse("1");\n`,
        "src/index.ts": `import { leaked } from "./lib.js";\nexport const downstream = leaked;\n`,
      },
      (root) => {
        const program = createProgramForDirectory(root);
        const sources = findAnySources(program, root);

        expect(
          sources.some(
            (source) =>
              source.sourceKind === "untyped-import" &&
              source.filePath.endsWith("index.ts") &&
              source.name === "leaked",
          ),
        ).toBe(true);
      },
    );
  });
});
