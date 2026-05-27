import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

export function countProjectSourceFiles(program: ts.Program): number {
  let n = 0;
  for (const sf of program.getSourceFiles()) {
    if (!isFromNodeModulesOrDts(sf)) n += 1;
  }
  return n;
}

function toPosix(p: string): string {
  return p.split(path.sep).join(path.posix.sep);
}

/**
 * Resolve a user path to an absolute directory (file → its dirname).
 */
export function resolveScanRoot(userPath: string): string {
  const abs = path.resolve(userPath);
  return fs.existsSync(abs) && fs.statSync(abs).isFile()
    ? path.dirname(abs)
    : abs;
}

export interface CreateProgramOptions {
  /** Cap the number of root source files (after tsconfig expansion). */
  maxFiles?: number;
}

/**
 * Create a TypeScript program for the tsconfig that governs `rootDir`.
 */
export function createProgramForDirectory(
  rootDir: string,
  opts?: CreateProgramOptions,
): ts.Program {
  const configPath = ts.findConfigFile(
    rootDir,
    ts.sys.fileExists,
    "tsconfig.json",
  );
  if (!configPath) {
    throw new Error(
      `Could not find tsconfig.json under ${rootDir}. Add one or pass a path that contains it.`,
    );
  }

  const readResult = ts.readConfigFile(configPath, ts.sys.readFile);
  if (readResult.error) {
    throw new Error(ts.formatDiagnostic(readResult.error, formatHost));
  }

  const parsed = ts.parseJsonConfigFileContent(
    readResult.config,
    ts.sys,
    path.dirname(configPath),
    undefined,
    configPath,
  );

  if (parsed.errors.length > 0) {
    const msg = parsed.errors
      .map((d) => ts.formatDiagnostic(d, formatHost))
      .join("\n");
    throw new Error(msg);
  }

  let rootNames = parsed.fileNames;
  if (opts?.maxFiles !== undefined && opts.maxFiles > 0) {
    rootNames = rootNames.slice(0, opts.maxFiles);
  }

  const programOptions: ts.CreateProgramOptions = {
    rootNames,
    options: parsed.options,
  };
  if (
    parsed.projectReferences !== undefined &&
    parsed.projectReferences.length > 0
  ) {
    programOptions.projectReferences = parsed.projectReferences;
  }
  return ts.createProgram(programOptions);
}

const formatHost: ts.FormatDiagnosticsHost = {
  getCanonicalFileName: (f) => f,
  getCurrentDirectory: ts.sys.getCurrentDirectory,
  getNewLine: () => ts.sys.newLine,
};

/**
 * Strip root prefix and normalize to project-relative POSIX paths.
 */
export function toProjectRelativePath(
  absoluteFile: string,
  rootDir: string,
): string {
  const rel = path.relative(rootDir, absoluteFile);
  if (rel.startsWith("..")) {
    return toPosix(absoluteFile);
  }
  return toPosix(rel);
}

export function isFromNodeModulesOrDts(sf: ts.SourceFile): boolean {
  return (
    sf.isDeclarationFile ||
    sf.fileName.includes(`${path.sep}node_modules${path.sep}`)
  );
}

/**
 * Plain JS inputs under `allowJs`: untyped parameters/returns/imports/catch resolve to `any` by language
 * design, not "developer chose any". Sources that use only type inference must skip these files.
 */
export function isJavaScriptInputFile(sf: ts.SourceFile): boolean {
  const ext = path.extname(sf.fileName).toLowerCase();
  return ext === ".js" || ext === ".jsx" || ext === ".mjs" || ext === ".cjs";
}
