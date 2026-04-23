import ts from "typescript";
import type { AnySource } from "../types.js";
import { findExplicitAnySources } from "./classify-explicit-any.js";
import { isFromNodeModulesOrDts, toProjectRelativePath } from "./load-project.js";

function isErrorType(t: ts.Type): boolean {
  return (t as ts.Type & { intrinsicName?: string }).intrinsicName === "error";
}

function isAnyType(t: ts.Type): boolean {
  return !isErrorType(t) && (t.flags & ts.TypeFlags.Any) !== 0;
}

function getDisplayName(decl: ts.Node): string {
  if (ts.isFunctionDeclaration(decl) && !decl.name) {
    return "(default)";
  }
  const name = ts.getNameOfDeclaration(decl as ts.Declaration);
  if (name && ts.isIdentifier(name)) return name.text;
  if (name && ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isVariableDeclaration(decl) && decl.initializer) {
    if (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer)) {
      return "(anonymous)";
    }
  }
  if (ts.isArrowFunction(decl) || ts.isFunctionExpression(decl)) {
    return "(anonymous)";
  }
  return "(unknown)";
}

function locationForReport(decl: ts.Node): ts.Node {
  const name = ts.getNameOfDeclaration(decl as ts.Declaration);
  if (name) return name;
  return decl;
}

function positionOfNode(node: ts.Node, sf: ts.SourceFile): { line: number; column: number } {
  const start = node.getStart(sf, false);
  const { line, character } = sf.getLineAndCharacterOfPosition(start);
  return { line: line + 1, column: character + 1 };
}

function findAncestorFunctionLike(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
  let n: ts.Node | undefined = node.parent;
  while (n) {
    if (
      ts.isFunctionDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n) ||
      ts.isMethodDeclaration(n) ||
      ts.isGetAccessorDeclaration(n) ||
      ts.isSetAccessorDeclaration(n)
    ) {
      return n;
    }
    n = n.parent;
  }
  return undefined;
}

function reportNodeForFunctionLike(fn: ts.FunctionLikeDeclaration): ts.Node {
  const p = fn.parent;
  if (ts.isVariableDeclaration(p) && p.initializer === fn) return p;
  if (ts.isPropertyDeclaration(p) && p.initializer === fn) return p;
  if (ts.isPropertyAssignment(p) && p.initializer === fn) return p;
  return fn;
}

function resolveAssertionLikeReportTarget(node: ts.AssertionExpression | ts.SatisfiesExpression): {
  report: ts.Node;
  name: string;
} {
  const p = node.parent;
  if (ts.isVariableDeclaration(p) && p.initializer === node) {
    return { report: locationForReport(p), name: getDisplayName(p) };
  }
  if (ts.isPropertyDeclaration(p) && p.initializer === node) {
    return { report: locationForReport(p), name: getDisplayName(p) };
  }
  if (ts.isReturnStatement(p) && p.expression === node) {
    const fn = findAncestorFunctionLike(p);
    if (!fn) {
      return { report: node, name: "(as-any)" };
    }
    const owner = reportNodeForFunctionLike(fn);
    const report = locationForReport(owner);
    return { report, name: getDisplayName(owner) };
  }
  if (ts.isExpressionStatement(p) && p.expression === node) {
    return { report: node, name: "(expr)" };
  }
  return { report: node, name: "(as-any)" };
}

function findAsAnySources(
  program: ts.Program,
  projectRootAbs: string,
  checker: ts.TypeChecker,
): AnySource[] {
  const out: AnySource[] = [];

  const visit = (node: ts.Node): void => {
    if (
      ts.isAsExpression(node) ||
      ts.isTypeAssertionExpression(node) ||
      ts.isSatisfiesExpression(node)
    ) {
      if (!isAnyType(checker.getTypeAtLocation(node))) {
        ts.forEachChild(node, visit);
        return;
      }
      const target = resolveAssertionLikeReportTarget(node);
      const sf = target.report.getSourceFile();
      const pos = positionOfNode(target.report, sf);
      out.push({
        filePath: toProjectRelativePath(sf.fileName, projectRootAbs),
        line: pos.line,
        column: pos.column,
        name: target.name,
        sourceKind: "as-any",
      });
    }
    ts.forEachChild(node, visit);
  };

  for (const sf of program.getSourceFiles()) {
    if (isFromNodeModulesOrDts(sf)) continue;
    visit(sf);
  }
  return out;
}

function findUntypedImportSources(
  program: ts.Program,
  projectRootAbs: string,
  checker: ts.TypeChecker,
): AnySource[] {
  const out: AnySource[] = [];

  const checkBinding = (id: ts.Identifier): void => {
    const t = checker.getTypeAtLocation(id);
    if (!isAnyType(t)) return;
    const sf = id.getSourceFile();
    const pos = positionOfNode(id, sf);
    out.push({
      filePath: toProjectRelativePath(sf.fileName, projectRootAbs),
      line: pos.line,
      column: pos.column,
      name: id.text,
      sourceKind: "untyped-import",
    });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && node.importClause && !node.importClause.isTypeOnly) {
      const clause = node.importClause;
      if (clause.name) {
        checkBinding(clause.name);
      }
      if (clause.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) {
          checkBinding(clause.namedBindings.name);
        } else {
          for (const spec of clause.namedBindings.elements) {
            if (!spec.isTypeOnly) {
              checkBinding(spec.name);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  for (const sf of program.getSourceFiles()) {
    if (isFromNodeModulesOrDts(sf)) continue;
    visit(sf);
  }
  return out;
}

function findUntypedReturnSources(
  program: ts.Program,
  projectRootAbs: string,
  checker: ts.TypeChecker,
): AnySource[] {
  const out: AnySource[] = [];

  const visitFn = (fn: ts.FunctionLikeDeclaration): void => {
    if (ts.isConstructorDeclaration(fn)) return;
    if (fn.type) return;
    const sig = checker.getSignatureFromDeclaration(fn);
    if (!sig) return;
    const ret = checker.getReturnTypeOfSignature(sig);
    if (!isAnyType(ret)) return;

    const reportNode = reportNodeForFunctionLike(fn);
    const at = locationForReport(reportNode);
    const sf = at.getSourceFile();
    const pos = positionOfNode(at, sf);
    out.push({
      filePath: toProjectRelativePath(sf.fileName, projectRootAbs),
      line: pos.line,
      column: pos.column,
      name: getDisplayName(reportNode),
      sourceKind: "untyped-return",
    });
  };

  const visit = (node: ts.Node): void => {
    if (
      ts.isFunctionDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      visitFn(node);
    }
    ts.forEachChild(node, visit);
  };

  for (const sf of program.getSourceFiles()) {
    if (isFromNodeModulesOrDts(sf)) continue;
    visit(sf);
  }
  return out;
}

function findCatchBindingSources(
  program: ts.Program,
  projectRootAbs: string,
  checker: ts.TypeChecker,
): AnySource[] {
  const out: AnySource[] = [];
  if (program.getCompilerOptions().useUnknownInCatchVariables === true) {
    return out;
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node) && node.variableDeclaration) {
      const vd = node.variableDeclaration;
      if (vd.type) {
        ts.forEachChild(node, visit);
        return;
      }
      const t = checker.getTypeAtLocation(vd.name);
      if (!isAnyType(t)) {
        ts.forEachChild(node, visit);
        return;
      }
      const report = vd.name;
      const sf = report.getSourceFile();
      const pos = positionOfNode(report, sf);
      const name = ts.isIdentifier(report) ? report.text : "(binding)";
      out.push({
        filePath: toProjectRelativePath(sf.fileName, projectRootAbs),
        line: pos.line,
        column: pos.column,
        name,
        sourceKind: "catch-binding",
      });
    }
    ts.forEachChild(node, visit);
  };

  for (const sf of program.getSourceFiles()) {
    if (isFromNodeModulesOrDts(sf)) continue;
    visit(sf);
  }
  return out;
}

function findImplicitParamSources(
  program: ts.Program,
  projectRootAbs: string,
  checker: ts.TypeChecker,
): AnySource[] {
  const out: AnySource[] = [];
  if (program.getCompilerOptions().noImplicitAny === true) {
    return out;
  }

  const visit = (node: ts.Node): void => {
    if (ts.isParameter(node)) {
      if (!ts.isIdentifier(node.name)) {
        ts.forEachChild(node, visit);
        return;
      }
      if (node.type) {
        ts.forEachChild(node, visit);
        return;
      }
      const t = checker.getTypeAtLocation(node.name);
      if (!isAnyType(t)) {
        ts.forEachChild(node, visit);
        return;
      }
      const report = node.name;
      const sf = report.getSourceFile();
      const pos = positionOfNode(report, sf);
      const name = node.name.text;
      out.push({
        filePath: toProjectRelativePath(sf.fileName, projectRootAbs),
        line: pos.line,
        column: pos.column,
        name,
        sourceKind: "implicit-param",
      });
    }
    ts.forEachChild(node, visit);
  };

  for (const sf of program.getSourceFiles()) {
    if (isFromNodeModulesOrDts(sf)) continue;
    visit(sf);
  }
  return out;
}

function sourceKey(s: AnySource): string {
  return `${s.sourceKind}\0${s.filePath}\0${s.line}\0${s.column}\0${s.name}`;
}

function sortSources(a: AnySource, b: AnySource): number {
  if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
  if (a.line !== b.line) return a.line - b.line;
  if (a.column !== b.column) return a.column - b.column;
  return a.sourceKind.localeCompare(b.sourceKind as string);
}

/**
 * All six v1 source kinds (PLAN §4), merged and de-duplicated by report location + kind.
 */
export function findAnySources(program: ts.Program, projectRootAbs: string): AnySource[] {
  const checker = program.getTypeChecker();
  const buckets: AnySource[] = [
    ...findExplicitAnySources(program, projectRootAbs),
    ...findAsAnySources(program, projectRootAbs, checker),
    ...findUntypedImportSources(program, projectRootAbs, checker),
    ...findUntypedReturnSources(program, projectRootAbs, checker),
    ...findCatchBindingSources(program, projectRootAbs, checker),
    ...findImplicitParamSources(program, projectRootAbs, checker),
  ];

  const seen = new Set<string>();
  const out: AnySource[] = [];
  for (const s of buckets) {
    const k = sourceKey(s);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  out.sort(sortSources);
  return out;
}
