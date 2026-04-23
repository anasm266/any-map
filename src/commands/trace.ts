import pc from "picocolors";
import { traceSymbol } from "../analyzer/trace.js";

export async function runTraceCommand(
  loc: string,
  targetPath: string | undefined,
  options: { json?: boolean },
): Promise<void> {
  const report = traceSymbol({ targetPath: targetPath ?? ".", loc });

  if (options.json === true) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const t = report.target;
  console.log(
    pc.bold(
      `Target ${t.filePath}:${t.line}:${t.column} \`${t.name}\` (${t.kind}) — ${report.paths.length} contributing source${
        report.paths.length === 1 ? "" : "s"
      }`,
    ),
  );

  if (report.paths.length === 0) {
    console.log(
      pc.dim("No `any` sources tag this symbol (clean or outside graph)."),
    );
    return;
  }

  for (const p of report.paths) {
    console.log("");
    console.log(
      pc.bold(
        `${p.sourceKind} ${p.filePath}:${p.line}:${p.column} \`${p.name}\``,
      ),
    );
    if (p.segments.length === 0) {
      console.log(pc.dim("  (source is the symbol)"));
      continue;
    }
    for (const seg of p.segments) {
      const line = `  ${seg.from.name} —${seg.reason}→ ${seg.to.name}  (${seg.from.filePath}:${seg.from.line}:${seg.from.column} → ${seg.to.filePath}:${seg.to.line}:${seg.to.column})`;
      console.log(line);
    }
  }
}
