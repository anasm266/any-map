#!/usr/bin/env node
/**
 * One-off: compare first pick by blast rank vs first greedy set-cover pick.
 * Run after build: `pnpm build && node scripts/overlap-analysis.mjs [path]`
 */
import { classifyScan } from "../dist/index.js";

const root = process.argv[2] ?? ".";
const summary = classifyScan({ targetPath: root });
const topBlast = summary.sourcesRankedByBlast[0];
const topGreedy = summary.greedyCoverPicks[0];
console.log(
  JSON.stringify(
    {
      project: root,
      infectedNodeCount: summary.infectedNodeCount,
      sourceCount: summary.sources.length,
      firstByBlast: topBlast
        ? { name: topBlast.name, blast: topBlast.blastRadius, id: topBlast.graphNodeId }
        : null,
      firstGreedy: topGreedy
        ? { name: topGreedy.name, pick: topGreedy.pick, id: topGreedy.graphNodeId }
        : null,
      sameTopPick: topBlast?.graphNodeId === topGreedy?.graphNodeId,
    },
    null,
    2,
  ),
);
