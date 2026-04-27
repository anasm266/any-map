import path from "node:path";
import { describe, expect, it } from "vitest";
import { diffScan } from "../../src/analyzer/diff-scan.js";
import { withTempGitRepo } from "../helpers/temp-git-repo.js";

const tsconfig = `{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true,
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "types/**/*.d.ts"]
}
`;

function withDiffRepo(
  baseFiles: Record<string, string | null>,
  headFiles: Record<string, string | null>,
  run: (ctx: { root: string; baseRef: string; headRef: string }) => void,
): void {
  withTempGitRepo(
    [
      {
        message: "base",
        files: {
          "tsconfig.json": tsconfig,
          ...baseFiles,
        },
      },
      {
        message: "head",
        files: headFiles,
      },
    ],
    ({ root, commits }) => {
      run({ root, baseRef: commits[0]!, headRef: commits[1]! });
    },
  );
}

describe("diffScan", () => {
  it("reports a new any source in addedSources", () => {
    withDiffRepo(
      {
        "src/index.ts": `export const typed = 1;\n`,
      },
      {
        "src/index.ts": `export const leaked: any = 1;\n`,
      },
      ({ root, baseRef, headRef }) => {
        const summary = diffScan({
          targetPath: root,
          baseRef,
          headRef,
        });

        expect(summary.scope).toBe("changed-files");
        expect(summary.addedSources.map((source) => source.name)).toContain(
          "leaked",
        );
        expect(summary.removedSources).toHaveLength(0);
      },
    );
  }, 20_000);

  it("reports a removed any source in removedSources", () => {
    withDiffRepo(
      {
        "src/index.ts": `export const leaked: any = 1;\n`,
      },
      {
        "src/index.ts": `export const leaked = 1;\n`,
      },
      ({ root, baseRef, headRef }) => {
        const summary = diffScan({
          targetPath: root,
          baseRef,
          headRef,
        });

        expect(summary.removedSources.map((source) => source.name)).toContain(
          "leaked",
        );
        expect(summary.addedSources).toHaveLength(0);
      },
    );
  }, 20_000);

  it("tracks blast radius changes for touched sources", () => {
    withDiffRepo(
      {
        "src/index.ts": `export const seed: any = 1;\nexport const one = seed;\n`,
      },
      {
        "src/index.ts": `export const seed: any = 1;\nexport const one = seed;\nexport const two = seed;\n`,
      },
      ({ root, baseRef, headRef }) => {
        const summary = diffScan({
          targetPath: root,
          baseRef,
          headRef,
        });

        const blastChange = summary.blastChangedSources.find(
          (change) => change.after.name === "seed",
        );
        expect(blastChange).toBeDefined();
        expect(blastChange?.deltaBlastRadius).toBeGreaterThan(0);
      },
    );
  }, 20_000);

  it("hides untouched-source blast changes in changed-files mode", () => {
    withDiffRepo(
      {
        "src/source.ts": `export function id(x: any) {\n  return x;\n}\n`,
        "src/consumer.ts": `import { id } from "./source";\nexport const one = id(1);\n`,
      },
      {
        "src/consumer.ts": `import { id } from "./source";\nexport const one = id(1);\nexport const two = id(2);\n`,
      },
      ({ root, baseRef, headRef }) => {
        const summary = diffScan({
          targetPath: root,
          baseRef,
          headRef,
        });

        expect(summary.scope).toBe("changed-files");
        expect(summary.changedFiles).toEqual(["src/consumer.ts"]);
        expect(summary.addedSources).toHaveLength(0);
        expect(summary.removedSources).toHaveLength(0);
        expect(summary.blastChangedSources).toHaveLength(0);
      },
    );
  }, 20_000);

  it("switches to full-project fallback when declaration files change", () => {
    withDiffRepo(
      {
        "src/index.ts": `export const leaked: any = 1;\n`,
      },
      {
        "types/global.d.ts": `declare module "x" { export const value: string; }\n`,
      },
      ({ root, baseRef, headRef }) => {
        const summary = diffScan({
          targetPath: root,
          baseRef,
          headRef,
        });

        expect(summary.scope).toBe("full-project-fallback");
        expect(summary.changedFiles).toContain("types/global.d.ts");
      },
    );
  }, 20_000);

  it("limits changed files to a nested scan path subtree", () => {
    withDiffRepo(
      {
        "src/nested/index.ts": `export const typed = 1;\n`,
        "src/other.ts": `export const untouched = 1;\n`,
      },
      {
        "src/nested/index.ts": `export const nestedLeak: any = 1;\n`,
        "src/other.ts": `export const outsideLeak: any = 1;\n`,
      },
      ({ root, baseRef, headRef }) => {
        const summary = diffScan({
          targetPath: path.join(root, "src", "nested"),
          baseRef,
          headRef,
        });

        expect(summary.changedFiles).toEqual(["index.ts"]);
        expect(summary.addedSources.map((source) => source.filePath)).toEqual([
          "index.ts",
        ]);
      },
    );
  }, 20_000);
});
