import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Minimal disk-backed TS project for graph / program tests (Linux + Windows).
 */
export function withTempProject(
  files: Record<string, string>,
  run: (root: string) => void,
): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "any-map-graph-"));
  try {
    fs.writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: true,
            skipLibCheck: true,
            noEmit: true,
            rootDir: "src",
          },
          include: ["src/**/*.ts"],
        },
        null,
        2,
      ),
    );
    for (const [rel, content] of Object.entries(files)) {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content, "utf8");
    }
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/**
 * `allowJs` project so `.js` files are program roots (inference-heavy `any` without explicit annotations).
 */
export function withAllowJsTempProject(
  files: Record<string, string>,
  run: (root: string) => void,
): void {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "any-map-allowjs-"));
  try {
    fs.writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "Bundler",
            strict: false,
            noImplicitAny: false,
            allowJs: true,
            skipLibCheck: true,
            noEmit: true,
            rootDir: "src",
          },
          include: ["src/**/*"],
        },
        null,
        2,
      ),
    );
    for (const [rel, content] of Object.entries(files)) {
      const p = path.join(root, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content, "utf8");
    }
    run(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
