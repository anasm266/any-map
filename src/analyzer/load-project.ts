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
  return fs.existsSync(abs) && fs.statSync(abs).isFile() ? path.dirname(abs) : abs;
}

/**
 * Create a TypeScript program for the tsconfig that governs `rootDir`.
 */
export function createProgramForDirectory(rootDir: string): ts.Program {
  const configPath = ts.findConfigFile(rootDir, ts.sys.fileExists, "tsconfig.json");
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
    const msg = parsed.errors.map((d) => ts.formatDiagnostic(d, formatHost)).join("\n");
    throw new Error(msg);
  }

  const programOptions: ts.CreateProgramOptions = {
    rootNames: parsed.fileNames,
    options: parsed.options,
  };
  if (parsed.projectReferences !== undefined && parsed.projectReferences.length > 0) {
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
export function toProjectRelativePath(absoluteFile: string, rootDir: string): string {
  const rel = path.relative(rootDir, absoluteFile);
  if (rel.startsWith("..")) {
    return toPosix(absoluteFile);
  }
  return toPosix(rel);
}

export function isFromNodeModulesOrDts(sf: ts.SourceFile): boolean {
  return sf.isDeclarationFile || sf.fileName.includes(`${path.sep}node_modules${path.sep}`);
}
