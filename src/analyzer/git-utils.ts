import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveScanRoot } from "./load-project.js";

export interface GitWorkspace {
  repoRoot: string;
  scanRoot: string;
  /** POSIX path from repo root to the requested scan root. Empty for repo root. */
  scanRootRepoRelative: string;
}

export interface SnapshotWorktrees {
  baseRoot: string;
  headRoot: string;
}

function toPosix(p: string): string {
  return p.split(path.sep).join(path.posix.sep);
}

function runGit(cwd: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    const message =
      error instanceof Error && "stderr" in error
        ? String((error as { stderr?: string }).stderr ?? "").trim()
        : "";
    const suffix = message.length > 0 ? `\n${message}` : "";
    throw new Error(`git ${args.join(" ")} failed.${suffix}`);
  }
}

function ensureInsideRepo(repoRoot: string, targetPath: string): string {
  const rel = path.relative(repoRoot, targetPath);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(
      `Path ${targetPath} is outside git repository root ${repoRoot}.`,
    );
  }
  return rel === "" ? "" : toPosix(rel);
}

export function resolveGitWorkspace(targetPath: string): GitWorkspace {
  const scanRoot = resolveScanRoot(targetPath);
  const repoRoot = runGit(scanRoot, ["rev-parse", "--show-toplevel"]);
  return {
    repoRoot,
    scanRoot,
    scanRootRepoRelative: ensureInsideRepo(repoRoot, scanRoot),
  };
}

export function resolveCommit(repoRoot: string, ref: string): string {
  return runGit(repoRoot, ["rev-parse", "--verify", `${ref}^{commit}`]);
}

export function resolveMergeBase(
  repoRoot: string,
  baseRef: string,
  headRef: string,
): string {
  return runGit(repoRoot, ["merge-base", baseRef, headRef]);
}

function parseChangedPaths(output: string): string[] {
  const paths = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    const fields = line.split("\t").slice(1);
    for (const filePath of fields) {
      const normalized = filePath.trim();
      if (normalized.length > 0) paths.add(normalized);
    }
  }
  return [...paths].sort((a, b) => a.localeCompare(b));
}

export function listChangedRepoPaths(
  repoRoot: string,
  baseRef: string,
  headRef: string,
  scanRootRepoRelative: string,
): string[] {
  const args = [
    "diff",
    "--name-status",
    "--find-renames",
    "--find-copies",
    baseRef,
    headRef,
  ];
  if (scanRootRepoRelative.length > 0) {
    args.push("--", scanRootRepoRelative);
  }
  return parseChangedPaths(runGit(repoRoot, args));
}

function attachNodeModulesLink(repoRoot: string, worktreeRoot: string): void {
  const source = path.join(repoRoot, "node_modules");
  if (!fs.existsSync(source)) return;
  const linkPath = path.join(worktreeRoot, "node_modules");
  if (fs.existsSync(linkPath)) return;
  fs.symlinkSync(
    source,
    linkPath,
    process.platform === "win32" ? "junction" : "dir",
  );
}

function removeNodeModulesLink(worktreeRoot: string): void {
  const linkPath = path.join(worktreeRoot, "node_modules");
  if (!fs.existsSync(linkPath)) return;
  fs.rmSync(linkPath, { recursive: true, force: true });
}

function cleanupWorktree(repoRoot: string, worktreeRoot: string): void {
  if (!fs.existsSync(worktreeRoot)) return;
  removeNodeModulesLink(worktreeRoot);
  try {
    runGit(repoRoot, ["worktree", "remove", "--force", worktreeRoot]);
  } catch {
    fs.rmSync(worktreeRoot, { recursive: true, force: true });
  }
}

export function withSnapshotWorktrees<T>(
  repoRoot: string,
  baseRef: string,
  headRef: string,
  run: (worktrees: SnapshotWorktrees) => T,
): T {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "any-map-diff-"));
  const baseRoot = path.join(tempRoot, "base");
  const headRoot = path.join(tempRoot, "head");

  try {
    runGit(repoRoot, ["worktree", "add", "--detach", baseRoot, baseRef]);
    runGit(repoRoot, ["worktree", "add", "--detach", headRoot, headRef]);
    attachNodeModulesLink(repoRoot, baseRoot);
    attachNodeModulesLink(repoRoot, headRoot);
    return run({ baseRoot, headRoot });
  } finally {
    cleanupWorktree(repoRoot, headRoot);
    cleanupWorktree(repoRoot, baseRoot);
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}
