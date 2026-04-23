import { createHash } from "node:crypto";

/**
 * Stable node id (PLAN §4): SHA-1 of path, position, name, and optional discriminator.
 */
export function makeNodeId(
  filePath: string,
  line: number,
  column: number,
  name: string,
  discriminator = "",
): string {
  const payload = [filePath, String(line), String(column), name, discriminator].join("\0");
  return createHash("sha1").update(payload).digest("hex");
}
