import ts from "typescript";
import type { AnySource } from "../types.js";
import { isFromNodeModulesOrDts, toProjectRelativePath } from "./load-project.js";

const SOURCE_KIND = "explicit-any" as const;

function isAsAnyAssertion(anyKw: ts.Node): boolean {
  const p = anyKw.parent;
  return (
    (ts.isAsExpression(p) && p.type === anyKw) ||
    (ts.isTypeAssertionExpression(p) && p.type === anyKw) ||
    (ts.isSatisfiesExpression(p) && p.type === anyKw)
  );
}

function typeSubtreeContains(root: ts.TypeNode | undefined, anyKw: ts.Node): boolean {
  if (!root) return false;
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (n === anyKw) {
      found = true;
      return;
    }
    ts.forEachChild(n, visit);
  };
  visit(root);
  return found;
}

function declarationOwnsAnyInAnnotatedType(decl: ts.Node, anyKw: ts.Node): boolean {
  if (
    ts.isFunctionDeclaration(decl) ||
    ts.isFunctionExpression(decl) ||
    ts.isArrowFunction(decl) ||
    ts.isMethodDeclaration(decl) ||
    ts.isConstructorDeclaration(decl) ||
    ts.isGetAccessorDeclaration(decl) ||
    ts.isSetAccessorDeclaration(decl)
  ) {
    return typeSubtreeContains(decl.type, anyKw);
  }
  if (
    ts.isVariableDeclaration(decl) ||
    ts.isParameter(decl) ||
    ts.isPropertyDeclaration(decl) ||
    ts.isPropertySignature(decl) ||
    ts.isTypeAliasDeclaration(decl) ||
    ts.isIndexSignatureDeclaration(decl)
  ) {
    return typeSubtreeContains(decl.type, anyKw);
  }
  return false;
}

function findOwningNamedDeclaration(anyKw: ts.Node): ts.Node | undefined {
  let n: ts.Node | undefined = anyKw.parent;
  while (n) {
    if (
      ts.isVariableDeclaration(n) ||
      ts.isParameter(n) ||
      ts.isPropertyDeclaration(n) ||
      ts.isPropertySignature(n) ||
      ts.isTypeAliasDeclaration(n) ||
      ts.isIndexSignatureDeclaration(n) ||
      ts.isFunctionDeclaration(n) ||
      ts.isMethodDeclaration(n) ||
      ts.isConstructorDeclaration(n) ||
      ts.isGetAccessorDeclaration(n) ||
      ts.isSetAccessorDeclaration(n) ||
      ts.isFunctionExpression(n) ||
      ts.isArrowFunction(n)
    ) {
      if (declarationOwnsAnyInAnnotatedType(n, anyKw)) {
        return n;
      }
    }
    n = n.parent;
  }
  return undefined;
}

function getDisplayName(decl: ts.Node): string {
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

/**
 * Collect every explicit `: any`-style annotation (including `any[]`, `Record<string, any>`, etc.),
 * excluding `as any` / `<any>` / `satisfies any` assertions (handled in m2).
 */
export function findExplicitAnySources(program: ts.Program, projectRootAbs: string): AnySource[] {
  const checker = program.getTypeChecker();
  const byDeclaration = new Map<ts.Node, AnySource>();

  const visit = (node: ts.Node): void => {
    if (node.kind === ts.SyntaxKind.AnyKeyword) {
      const anyKw = node;
      if (isAsAnyAssertion(anyKw)) {
        ts.forEachChild(node, visit);
        return;
      }

      const decl = findOwningNamedDeclaration(anyKw);
      if (!decl) {
        ts.forEachChild(node, visit);
        return;
      }

      const typeNode: ts.TypeNode | undefined =
        ts.isVariableDeclaration(decl) ||
        ts.isParameter(decl) ||
        ts.isPropertyDeclaration(decl) ||
        ts.isPropertySignature(decl) ||
        ts.isTypeAliasDeclaration(decl) ||
        ts.isIndexSignatureDeclaration(decl) ||
        ts.isFunctionDeclaration(decl) ||
        ts.isFunctionExpression(decl) ||
        ts.isArrowFunction(decl) ||
        ts.isMethodDeclaration(decl) ||
        ts.isConstructorDeclaration(decl) ||
        ts.isGetAccessorDeclaration(decl) ||
        ts.isSetAccessorDeclaration(decl)
          ? decl.type
          : undefined;

      if (!typeNode || !typeSubtreeContains(typeNode, anyKw)) {
        ts.forEachChild(node, visit);
        return;
      }

      const at = locationForReport(decl);
      const sf = at.getSourceFile();
      const start = at.getStart(sf, false);
      const { line, character } = sf.getLineAndCharacterOfPosition(start);

      const t = checker.getTypeAtLocation(typeNode);
      if ((t as ts.Type & { intrinsicName?: string }).intrinsicName === "error") {
        ts.forEachChild(node, visit);
        return;
      }
      if ((t.flags & ts.TypeFlags.Any) === 0) {
        ts.forEachChild(node, visit);
        return;
      }

      const filePath = toProjectRelativePath(sf.fileName, projectRootAbs);
      const name = getDisplayName(decl);

      const source: AnySource = {
        filePath,
        line: line + 1,
        column: character + 1,
        name,
        sourceKind: SOURCE_KIND,
      };

      const existing = byDeclaration.get(decl);
      if (!existing) {
        byDeclaration.set(decl, source);
      }
    }
    ts.forEachChild(node, visit);
  };

  for (const sf of program.getSourceFiles()) {
    if (isFromNodeModulesOrDts(sf)) continue;
    visit(sf);
  }

  return [...byDeclaration.values()].sort((a, b) => {
    if (a.filePath !== b.filePath) return a.filePath.localeCompare(b.filePath);
    if (a.line !== b.line) return a.line - b.line;
    return a.column - b.column;
  });
}
