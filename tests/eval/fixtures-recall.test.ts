import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AnySource, SourceKind } from "../../src/types.js";
import { classifyScan } from "../../src/analyzer/run-scan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, "../fixtures");

interface ExpectedEntry {
  file: string;
  line: number;
  column: number;
  name: string;
  sourceKind: SourceKind;
}

interface ExpectedFile {
  expected: ExpectedEntry[];
}

function fixtureDirsWithExpected(): string[] {
  return fs
    .readdirSync(fixturesRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) =>
      fs.existsSync(path.join(fixturesRoot, name, "expected.json")),
    );
}

function key(
  s: Pick<AnySource, "filePath" | "line" | "column" | "name" | "sourceKind">,
): string {
  return `${s.sourceKind}\0${s.filePath}\0${s.line}\0${s.column}\0${s.name}`;
}

describe("fixture recall (m2)", () => {
  for (const dir of fixtureDirsWithExpected()) {
    it(`matches expected.json for ${dir}`, () => {
      const root = path.join(fixturesRoot, dir);
      const raw = fs.readFileSync(path.join(root, "expected.json"), "utf8");
      const { expected } = JSON.parse(raw) as ExpectedFile;

      const summary = classifyScan({ targetPath: root });
      const actual = summary.sources;

      expect(actual.length).toBe(expected.length);
      expect(summary.sourcesRankedByBlast).toHaveLength(actual.length);

      const actualKeys = new Set(actual.map(key));
      for (const e of expected) {
        const k = key({
          filePath: e.file,
          line: e.line,
          column: e.column,
          name: e.name,
          sourceKind: e.sourceKind,
        });
        expect(actualKeys.has(k), `missing ${k}`).toBe(true);
      }
    });
  }
});
