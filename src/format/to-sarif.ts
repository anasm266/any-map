import type {
  DiffSummary,
  ScanSummary,
  SourceKind,
  SourceRanked,
} from "../types.js";

const TOOL_NAME = "any-map";
let toolVersion = "0.0.0";

export function setSarifToolVersion(version: string): void {
  toolVersion = version;
}
const SARIF_VERSION = "2.1.0";

const SOURCE_KIND_RULES: SourceKind[] = [
  "explicit-any",
  "as-any",
  "untyped-import",
  "untyped-return",
  "catch-binding",
  "implicit-param",
];

function ruleId(kind: SourceKind): string {
  return `any-map/${kind}`;
}

function buildRules() {
  return SOURCE_KIND_RULES.map((kind) => ({
    id: ruleId(kind),
    name: kind,
    shortDescription: { text: `TypeScript any source: ${kind}` },
    fullDescription: {
      text: `Classifier reported an any source of kind ${kind}.`,
    },
    defaultConfiguration: { level: "warning" as const },
  }));
}

function locationFor(
  source: Pick<SourceRanked, "filePath" | "line" | "column">,
) {
  return {
    physicalLocation: {
      artifactLocation: { uri: source.filePath },
      region: { startLine: source.line, startColumn: source.column },
    },
  };
}

function resultFromSource(
  source: SourceRanked,
  messageText: string,
): Record<string, unknown> {
  return {
    ruleId: ruleId(source.sourceKind),
    level: "warning",
    message: { text: messageText },
    locations: [{ location: locationFor(source) }],
  };
}

export function scanSummaryToSarif(
  summary: ScanSummary,
): Record<string, unknown> {
  const results = summary.sourcesRankedByBlast.map((s) =>
    resultFromSource(
      s,
      `any source (blast ${s.blastRadius})${summary.health ? ` — ${summary.health.summaryLine}` : ""}`,
    ),
  );
  return {
    version: SARIF_VERSION,
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: TOOL_NAME,
            version: toolVersion,
            informationUri: "https://github.com/anasm266/any-map",
            rules: buildRules(),
          },
        },
        results,
      },
    ],
  };
}

export function diffSummaryToSarif(
  summary: DiffSummary,
): Record<string, unknown> {
  const results: Record<string, unknown>[] = [];
  for (const s of summary.addedSources) {
    results.push(
      resultFromSource(s, `New any source on branch (blast ${s.blastRadius})`),
    );
  }
  for (const c of summary.blastChangedSources) {
    if (c.deltaBlastRadius <= 0) continue;
    results.push(
      resultFromSource(
        c.after,
        `Blast radius increased by ${c.deltaBlastRadius} (${c.before.blastRadius} -> ${c.after.blastRadius})`,
      ),
    );
  }
  return {
    version: SARIF_VERSION,
    $schema:
      "https://raw.githubusercontent.com/oasis-tcs/sarif-spec/master/Schemata/sarif-schema-2.1.0.json",
    runs: [
      {
        tool: {
          driver: {
            name: TOOL_NAME,
            version: toolVersion,
            informationUri: "https://github.com/anasm266/any-map",
            rules: buildRules(),
          },
        },
        results,
      },
    ],
  };
}
