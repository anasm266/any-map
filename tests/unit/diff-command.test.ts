import { afterEach, describe, expect, it, vi } from "vitest";
import { runDiffCommand } from "../../src/commands/diff.js";
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
  "include": ["src/**/*.ts"]
}
`;

function withDiffRepo(
  baseFiles: Record<string, string | null>,
  headFiles: Record<string, string | null>,
  run: (ctx: {
    root: string;
    baseRef: string;
    headRef: string;
  }) => Promise<void> | void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
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
          Promise.resolve(
            run({ root, baseRef: commits[0]!, headRef: commits[1]! }),
          ).then(resolve, reject);
        },
      );
    } catch (error) {
      reject(error);
    }
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runDiffCommand", () => {
  it("emits stable parseable JSON", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value?: unknown) => {
      logs.push(String(value ?? ""));
    });

    await withDiffRepo(
      {
        "src/index.ts": `export const typed = 1;\n`,
      },
      {
        "src/index.ts": `export const leaked: any = 1;\n`,
      },
      async ({ root, baseRef, headRef }) => {
        await runDiffCommand(baseRef, headRef, root, { format: "json" });
      },
    );

    expect(logs).toHaveLength(1);
    const parsed = JSON.parse(logs[0]!);
    expect(parsed.compareMode).toBe("merge-base");
    expect(parsed.scope).toBe("changed-files");
    expect(parsed.addedSources[0]?.name).toBe("leaked");
  }, 20_000);

  it("omits empty delta sections in table output", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((value?: unknown) => {
      logs.push(String(value ?? ""));
    });

    await withDiffRepo(
      {
        "src/index.ts": `export const typed = 1;\n`,
      },
      {
        "README.md": `docs only\n`,
      },
      async ({ root, baseRef, headRef }) => {
        await runDiffCommand(baseRef, headRef, root, { format: "table" });
      },
    );

    const output = logs.join("\n");
    expect(output).toContain("No any-source deltas in the reported scope.");
    expect(output).not.toContain("Added sources");
    expect(output).not.toContain("Removed sources");
    expect(output).not.toContain("Blast radius changes");
  }, 20_000);
});
