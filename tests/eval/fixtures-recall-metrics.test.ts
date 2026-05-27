import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { AnySource, SourceKind } from "../../src/types.js";
import { classifyScan } from "../../src/analyzer/run-scan.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fixturesRoot = path.join(__dirname, "../fixtures");

const RECALL_MIN = 0.95;
const PRECISION_MIN = 0.9;

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

describe("fixture recall metrics (CI gate)", () => {
  it(
    "meets recall and precision thresholds across all fixtures",
    () => {
    let totalExpected = 0;
    let totalActual = 0;
    let truePositives = 0;

    for (const dir of fixtureDirsWithExpected()) {
      const root = path.join(fixturesRoot, dir);
      const raw = fs.readFileSync(path.join(root, "expected.json"), "utf8");
      const { expected } = JSON.parse(raw) as ExpectedFile;
      const actual = classifyScan({ targetPath: root }).sources;

      totalExpected += expected.length;
      totalActual += actual.length;

      const actualKeys = new Set(actual.map(key));
      for (const e of expected) {
        const k = key({
          filePath: e.file,
          line: e.line,
          column: e.column,
          name: e.name,
          sourceKind: e.sourceKind,
        });
        if (actualKeys.has(k)) truePositives++;
      }
    }

    const recall = totalExpected === 0 ? 1 : truePositives / totalExpected;
    const precision = totalActual === 0 ? 1 : truePositives / totalActual;

    expect(recall, `recall ${recall}`).toBeGreaterThanOrEqual(RECALL_MIN);
    expect(precision, `precision ${precision}`).toBeGreaterThanOrEqual(
      PRECISION_MIN,
    );
    },
    60_000,
  );
});
