import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface TempGitCommitSpec {
  message: string;
  files: Record<string, string | null>;
}

export interface TempGitRepo {
  root: string;
  commits: string[];
}

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function writeFiles(root: string, files: Record<string, string | null>): void {
  for (const [relativePath, content] of Object.entries(files)) {
    const fullPath = path.join(root, relativePath);
    if (content === null) {
      fs.rmSync(fullPath, { recursive: true, force: true });
      continue;
    }
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content, "utf8");
  }
}

export function withTempGitRepo(
  commits: TempGitCommitSpec[],
  run: (repo: TempGitRepo) => void,
): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "any-map-git-"));
  try {
    git(root, ["init"]);
    git(root, ["checkout", "-b", "main"]);
    git(root, ["config", "user.name", "any-map test"]);
    git(root, ["config", "user.email", "any-map@example.com"]);

    const shas: string[] = [];
    for (const commit of commits) {
      writeFiles(root, commit.files);
      git(root, ["add", "-A"]);
      git(root, ["commit", "--allow-empty", "-m", commit.message]);
      shas.push(git(root, ["rev-parse", "HEAD"]));
    }

    run({ root, commits: shas });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
