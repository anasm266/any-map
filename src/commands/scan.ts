import pc from "picocolors";
import { classifyExplicitAnyScan, type ScanM1Options } from "../analyzer/run-scan-m1.js";

export async function runScanCommand(
  targetPath: string | undefined,
  options: { json?: boolean },
): Promise<void> {
  const opts: ScanM1Options = {
    targetPath: targetPath ?? ".",
    json: options.json === true,
  };

  const summary = classifyExplicitAnyScan(opts);

  if (opts.json) {
    console.log(JSON.stringify(summary, null, 2));
    return;
  }

  const n = summary.explicitAnySources.length;
  const files = summary.fileCount;

  console.log(
    pc.bold(
      `Found ${n} explicit-any source${n === 1 ? "" : "s"} in ${files} project file${files === 1 ? "" : "s"}.`,
    ),
  );

  if (n === 0) {
    return;
  }

  console.log("");
  for (const s of summary.explicitAnySources) {
    console.log(
      `${pc.dim(s.filePath)}:${s.line}:${s.column}  ${pc.yellow(s.sourceKind)}  ${pc.bold(s.name)}`,
    );
  }
}
