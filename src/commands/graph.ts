import fs from "node:fs";
import { runFullScan } from "../analyzer/run-scan.js";
import type { SourceKind } from "../types.js";
import { serializedGraphToDot } from "../format/to-dot.js";

export async function runGraphCommand(
  targetPath: string | undefined,
  options: {
    output?: string;
    sourceKinds?: SourceKind[];
    ignoreGlobs?: string[];
  },
): Promise<void> {
  const { serializedGraph } = runFullScan({
    targetPath: targetPath ?? ".",
    sourceKinds: options.sourceKinds,
    ignoreGlobs: options.ignoreGlobs,
  });

  const dot = serializedGraphToDot(serializedGraph);
  if (options.output) {
    fs.writeFileSync(options.output, dot, "utf8");
  } else {
    console.log(dot);
  }
}
