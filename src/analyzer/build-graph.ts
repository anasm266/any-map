import ts from "typescript";
import type {
  AnySource,
  GreedyCoverPick,
  SourceKind,
  SourceRanked,
} from "../types.js";
import type {
  EdgeReason,
  GraphEdge,
  GraphNodeKind,
  GraphNodeMutable,
  SerializedGraph,
} from "./graph-types.js";
import type { TraceHop } from "./trace-types.js";
import {
  isFromNodeModulesOrDts,
  toProjectRelativePath,
} from "./load-project.js";
import { makeNodeId } from "./node-id.js";

function getEnclosingFunctionLike(
  node: ts.Node,
): ts.FunctionLikeDeclaration | undefined {
  let p: ts.Node | undefined = node.parent;
  while (p) {
    if (
      ts.isFunctionDeclaration(p) ||
      ts.isFunctionExpression(p) ||
      ts.isArrowFunction(p) ||
      ts.isMethodDeclaration(p) ||
      ts.isConstructorDeclaration(p) ||
      ts.isGetAccessorDeclaration(p) ||
      ts.isSetAccessorDeclaration(p)
    ) {
      return p;
    }
    p = p.parent;
  }
  return undefined;
}

function isCallableFunctionLike(
  node: ts.Node,
): node is
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node)
  );
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isPrivateIdentifier(name)) return name.text;
  if (ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

export class GraphBuilder {
  private readonly checker: ts.TypeChecker;
  private readonly nodes = new Map<string, GraphNodeMutable>();
  private readonly edgeList: GraphEdge[] = [];
  /** Type flows `from` → `to` (PLAN §5.2). */
  private readonly outgoing = new Map<string, GraphEdge[]>();
  private readonly exportChainCache = new Map<string, string | undefined>();

  constructor(
    private readonly program: ts.Program,
    private readonly projectRootAbs: string,
  ) {
    this.checker = program.getTypeChecker();
  }

  private rel(sf: ts.SourceFile): string {
    return toProjectRelativePath(sf.fileName, this.projectRootAbs);
  }

  private isUserSourceFile(sf: ts.SourceFile): boolean {
    return !isFromNodeModulesOrDts(sf);
  }

  private addEdge(from: string, to: string, reason: EdgeReason): void {
    if (from === to) return;
    const edge: GraphEdge = { from, to, reason };
    this.edgeList.push(edge);
    const list = this.outgoing.get(from);
    if (list) list.push(edge);
    else this.outgoing.set(from, [edge]);
  }

  private typeStringAt(node: ts.Node): string {
    const t = this.checker.getTypeAtLocation(node);
    return this.checker.typeToString(
      t,
      undefined,
      ts.TypeFormatFlags.NoTruncation,
    );
  }

  private ensureNamedDecl(
    decl: ts.NamedDeclaration,
    kind: GraphNodeKind,
    discriminator = "",
  ): string | undefined {
    if (!decl.name || !ts.isIdentifier(decl.name)) return undefined;
    const sf = decl.getSourceFile();
    if (!this.isUserSourceFile(sf)) return undefined;
    const filePath = this.rel(sf);
    const name = decl.name;
    const start = name.getStart(sf, false);
    const { line, character } = sf.getLineAndCharacterOfPosition(start);
    const line1 = line + 1;
    const col1 = character + 1;
    const id = makeNodeId(filePath, line1, col1, name.text, discriminator);
    if (!this.nodes.has(id)) {
      this.nodes.set(id, {
        id,
        filePath,
        line: line1,
        column: col1,
        name: name.text,
        kind,
        typeString: this.typeStringAt(name),
        isSource: false,
        infectedBy: new Set(),
      });
    }
    return id;
  }

  private ensurePropertyNamedNode(
    name: ts.PropertyName,
    discriminator = "",
  ): string | undefined {
    const text = propertyNameText(name);
    if (!text) return undefined;
    const sf = name.getSourceFile();
    if (!this.isUserSourceFile(sf)) return undefined;
    const filePath = this.rel(sf);
    const start = name.getStart(sf, false);
    const { line, character } = sf.getLineAndCharacterOfPosition(start);
    const line1 = line + 1;
    const col1 = character + 1;
    const id = makeNodeId(filePath, line1, col1, text, discriminator);
    if (!this.nodes.has(id)) {
      this.nodes.set(id, {
        id,
        filePath,
        line: line1,
        column: col1,
        name: text,
        kind: "property",
        typeString: this.typeStringAt(name),
        isSource: false,
        infectedBy: new Set(),
      });
    }
    return id;
  }

  private declarationForSymbol(
    sym: ts.Symbol | undefined,
  ): ts.Declaration | undefined {
    return (
      sym?.declarations?.find(
        (decl) =>
          ts.isImportClause(decl) ||
          ts.isImportSpecifier(decl) ||
          ts.isNamespaceImport(decl) ||
          ts.isImportEqualsDeclaration(decl),
      ) ?? sym?.valueDeclaration
    );
  }

  private propertySymbolForElementAccess(
    expr: ts.ElementAccessExpression,
  ): ts.Symbol | undefined {
    const arg = expr.argumentExpression;
    if (!arg || (!ts.isStringLiteralLike(arg) && !ts.isNumericLiteral(arg))) {
      return undefined;
    }
    const key = arg.text;
    const baseType = this.checker.getTypeAtLocation(expr.expression);
    const apparent = this.checker.getApparentType(baseType);
    return (
      this.checker.getPropertyOfType(apparent, key) ??
      this.checker.getPropertyOfType(baseType, key)
    );
  }

  private reasonForValueRead(expr: ts.Expression): EdgeReason {
    if (ts.isParenthesizedExpression(expr)) {
      return this.reasonForValueRead(expr.expression);
    }
    if (
      ts.isAsExpression(expr) ||
      ts.isTypeAssertionExpression(expr) ||
      ts.isSatisfiesExpression(expr) ||
      ts.isNonNullExpression(expr)
    ) {
      return this.reasonForValueRead(expr.expression);
    }
    if (ts.isPropertyAccessExpression(expr)) return "property-access";
    if (ts.isElementAccessExpression(expr)) return "index-access";
    return "assignment";
  }

  private ensureFromValueDeclaration(vd: ts.Declaration): string | undefined {
    if (ts.isImportClause(vd) && vd.name) {
      return this.ensureImportBinding(vd.name);
    }
    if (ts.isImportSpecifier(vd) && ts.isIdentifier(vd.name)) {
      return this.ensureImportBinding(vd.name);
    }
    if (ts.isNamespaceImport(vd)) {
      return this.ensureImportBinding(vd.name);
    }
    if (ts.isImportEqualsDeclaration(vd)) {
      return this.ensureImportBinding(vd.name);
    }
    if (ts.isVariableDeclaration(vd) && ts.isIdentifier(vd.name)) {
      return this.ensureNamedDecl(vd, "variable");
    }
    if (ts.isFunctionDeclaration(vd) && vd.name) {
      return this.ensureNamedDecl(vd, "variable");
    }
    if (ts.isParameter(vd) && ts.isIdentifier(vd.name)) {
      return this.ensureNamedDecl(vd, "parameter");
    }
    if (ts.isPropertyDeclaration(vd) && ts.isIdentifier(vd.name)) {
      return this.ensureNamedDecl(vd, "property");
    }
    if (ts.isGetAccessorDeclaration(vd)) {
      return this.ensurePropertyNamedNode(vd.name, "getter");
    }
    if (ts.isPropertyAssignment(vd)) {
      return this.ensurePropertyNamedNode(vd.name, "object");
    }
    if (ts.isShorthandPropertyAssignment(vd)) {
      return this.ensurePropertyNamedNode(vd.name, "object");
    }
    return undefined;
  }

  private ensureImportBinding(ident: ts.Identifier): string | undefined {
    const sf = ident.getSourceFile();
    if (!this.isUserSourceFile(sf)) return undefined;
    const filePath = this.rel(sf);
    const start = ident.getStart(sf, false);
    const { line, character } = sf.getLineAndCharacterOfPosition(start);
    const line1 = line + 1;
    const col1 = character + 1;
    const nid = makeNodeId(filePath, line1, col1, ident.text, "");
    if (!this.nodes.has(nid)) {
      this.nodes.set(nid, {
        id: nid,
        filePath,
        line: line1,
        column: col1,
        name: ident.text,
        kind: "import-binding",
        typeString: this.typeStringAt(ident),
        isSource: false,
        infectedBy: new Set(),
      });
    }
    return nid;
  }

  private ensureExportBinding(
    exportNameNode: ts.Node,
    exportNameText: string,
    discriminator = "",
  ): string | undefined {
    const sf = exportNameNode.getSourceFile();
    if (!this.isUserSourceFile(sf)) return undefined;
    const filePath = this.rel(sf);
    const start = exportNameNode.getStart(sf, false);
    const { line, character } = sf.getLineAndCharacterOfPosition(start);
    const line1 = line + 1;
    const col1 = character + 1;
    const nid = makeNodeId(
      filePath,
      line1,
      col1,
      exportNameText,
      discriminator,
    );
    if (!this.nodes.has(nid)) {
      this.nodes.set(nid, {
        id: nid,
        filePath,
        line: line1,
        column: col1,
        name: exportNameText,
        kind: "export-binding",
        typeString: this.typeStringAt(exportNameNode),
        isSource: false,
        infectedBy: new Set(),
      });
    }
    return nid;
  }

  private ensureBindingElement(el: ts.BindingElement): string | undefined {
    if (!ts.isIdentifier(el.name)) return undefined;
    const sf = el.getSourceFile();
    if (!this.isUserSourceFile(sf)) return undefined;
    const filePath = this.rel(sf);
    const name = el.name;
    const start = name.getStart(sf, false);
    const { line, character } = sf.getLineAndCharacterOfPosition(start);
    const line1 = line + 1;
    const col1 = character + 1;
    const id = makeNodeId(filePath, line1, col1, name.text, "bind");
    if (!this.nodes.has(id)) {
      this.nodes.set(id, {
        id,
        filePath,
        line: line1,
        column: col1,
        name: name.text,
        kind: "variable",
        typeString: this.typeStringAt(name),
        isSource: false,
        infectedBy: new Set(),
      });
    }
    return id;
  }

  private symbolName(sym: ts.Symbol): string {
    return sym.escapedName.toString();
  }

  private resolveAliasedSymbol(sym: ts.Symbol): ts.Symbol {
    return (sym.flags & ts.SymbolFlags.Alias) !== 0
      ? this.checker.getAliasedSymbol(sym)
      : sym;
  }

  private moduleSymbolForSpecifier(
    moduleSpecifier: ts.Expression | undefined,
  ): ts.Symbol | undefined {
    if (!moduleSpecifier || !ts.isStringLiteral(moduleSpecifier))
      return undefined;
    return this.checker.getSymbolAtLocation(moduleSpecifier);
  }

  private moduleKey(moduleSym: ts.Symbol, exportName: string): string {
    const decl = moduleSym.declarations?.[0];
    if (decl) {
      return `${this.rel(decl.getSourceFile())}\0${exportName}`;
    }
    return `${this.symbolName(moduleSym)}\0${exportName}`;
  }

  private exportedSymbolByName(
    moduleSym: ts.Symbol,
    exportName: string,
  ): ts.Symbol | undefined {
    return this.checker
      .getExportsOfModule(moduleSym)
      .find((sym) => this.symbolName(sym) === exportName);
  }

  private sourceFileForModuleSymbol(
    moduleSym: ts.Symbol,
  ): ts.SourceFile | undefined {
    const decl = moduleSym.declarations?.[0];
    if (!decl) return undefined;
    const sf = decl.getSourceFile();
    return this.isUserSourceFile(sf) ? sf : undefined;
  }

  private exportChainMatches(
    moduleSym: ts.Symbol,
    exportName: string,
    target: ts.Symbol,
  ): boolean {
    const candidate = this.exportedSymbolByName(moduleSym, exportName);
    if (!candidate) return false;
    return this.resolveAliasedSymbol(candidate) === target;
  }

  private buildExportChain(
    moduleSym: ts.Symbol,
    exportName: string,
    seen = new Set<string>(),
  ): string | undefined {
    const cacheKey = this.moduleKey(moduleSym, exportName);
    if (this.exportChainCache.has(cacheKey)) {
      return this.exportChainCache.get(cacheKey);
    }
    if (seen.has(cacheKey)) return undefined;
    const nextSeen = new Set(seen);
    nextSeen.add(cacheKey);

    const exportSym = this.exportedSymbolByName(moduleSym, exportName);
    if (!exportSym) {
      this.exportChainCache.set(cacheKey, undefined);
      return undefined;
    }

    const exportSpecifierDecl = exportSym.declarations?.find(
      ts.isExportSpecifier,
    );
    if (exportSpecifierDecl) {
      const exportId = this.ensureExportBinding(
        exportSpecifierDecl.name,
        exportSpecifierDecl.name.text,
      );
      const exportDecl = exportSpecifierDecl.parent.parent;
      const sourceExportName =
        exportSpecifierDecl.propertyName?.text ?? exportSpecifierDecl.name.text;
      let upstreamId: string | undefined;

      if (exportDecl.moduleSpecifier) {
        const upstreamModule = this.moduleSymbolForSpecifier(
          exportDecl.moduleSpecifier,
        );
        if (upstreamModule) {
          upstreamId = this.buildExportChain(
            upstreamModule,
            sourceExportName,
            nextSeen,
          );
        }
      } else {
        const localRef =
          exportSpecifierDecl.propertyName ?? exportSpecifierDecl.name;
        const localSym = this.checker.getSymbolAtLocation(localRef);
        const localDecl =
          localSym &&
          this.declarationForSymbol(this.resolveAliasedSymbol(localSym));
        if (localDecl) upstreamId = this.ensureFromValueDeclaration(localDecl);
      }

      if (upstreamId && exportId)
        this.addEdge(upstreamId, exportId, "re-export");
      const resolvedId = exportId ?? upstreamId;
      this.exportChainCache.set(cacheKey, resolvedId);
      return resolvedId;
    }

    const resolvedExportSym = this.resolveAliasedSymbol(exportSym);
    const moduleSf = this.sourceFileForModuleSymbol(moduleSym);
    if (moduleSf) {
      for (const stmt of moduleSf.statements) {
        if (
          !ts.isExportDeclaration(stmt) ||
          stmt.isTypeOnly ||
          stmt.exportClause !== undefined
        ) {
          continue;
        }
        const upstreamModule = this.moduleSymbolForSpecifier(
          stmt.moduleSpecifier,
        );
        if (!upstreamModule) continue;
        if (
          !this.exportChainMatches(
            upstreamModule,
            exportName,
            resolvedExportSym,
          )
        ) {
          continue;
        }
        const exportId = this.ensureExportBinding(
          stmt.moduleSpecifier!,
          exportName,
          "star",
        );
        const upstreamId = this.buildExportChain(
          upstreamModule,
          exportName,
          nextSeen,
        );
        if (upstreamId && exportId)
          this.addEdge(upstreamId, exportId, "re-export");
        const resolvedId = exportId ?? upstreamId;
        this.exportChainCache.set(cacheKey, resolvedId);
        return resolvedId;
      }
    }

    const originDecl = this.declarationForSymbol(resolvedExportSym);
    const resolvedId = originDecl
      ? this.ensureFromValueDeclaration(originDecl)
      : undefined;
    this.exportChainCache.set(cacheKey, resolvedId);
    return resolvedId;
  }

  private returnAnchor(
    fn: ts.FunctionLikeDeclaration,
  ):
    | { filePath: string; line: number; column: number; displayName: string }
    | undefined {
    const sf = fn.getSourceFile();
    const filePath = this.rel(sf);
    const vp = fn.parent;
    if (ts.isVariableDeclaration(vp) && ts.isIdentifier(vp.name)) {
      const pos = vp.name.getStart(sf, false);
      const { line, character } = sf.getLineAndCharacterOfPosition(pos);
      return {
        filePath,
        line: line + 1,
        column: character + 1,
        displayName: vp.name.text,
      };
    }
    if (
      ts.isPropertyDeclaration(vp) &&
      ts.isIdentifier(vp.name) &&
      (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))
    ) {
      const pos = vp.name.getStart(sf, false);
      const { line, character } = sf.getLineAndCharacterOfPosition(pos);
      return {
        filePath,
        line: line + 1,
        column: character + 1,
        displayName: vp.name.text,
      };
    }
    if (ts.isFunctionDeclaration(fn) && fn.name) {
      const pos = fn.name.getStart(sf, false);
      const { line, character } = sf.getLineAndCharacterOfPosition(pos);
      return {
        filePath,
        line: line + 1,
        column: character + 1,
        displayName: fn.name.text,
      };
    }
    if (ts.isMethodDeclaration(fn) && ts.isIdentifier(fn.name)) {
      const pos = fn.name.getStart(sf, false);
      const { line, character } = sf.getLineAndCharacterOfPosition(pos);
      return {
        filePath,
        line: line + 1,
        column: character + 1,
        displayName: fn.name.text,
      };
    }
    return undefined;
  }

  private ensureReturnNode(fn: ts.FunctionLikeDeclaration): string | undefined {
    const anchor = this.returnAnchor(fn);
    if (!anchor) return undefined;
    const { filePath, line, column, displayName } = anchor;
    const id = makeNodeId(filePath, line, column, displayName, "return");
    if (!this.nodes.has(id)) {
      const sig = this.checker.getSignatureFromDeclaration(fn);
      const rt = sig
        ? this.checker.getReturnTypeOfSignature(sig)
        : this.checker.getTypeAtLocation(fn);
      const typeString = this.checker.typeToString(
        rt,
        undefined,
        ts.TypeFormatFlags.NoTruncation,
      );
      this.nodes.set(id, {
        id,
        filePath,
        line,
        column,
        name: displayName,
        kind: "return",
        typeString,
        isSource: false,
        infectedBy: new Set(),
      });
    }
    return id;
  }

  /** Value-flow sources: identifiers / simple references with a registered declaration. */
  exprToNodeId(expr: ts.Expression): string | undefined {
    if (ts.isParenthesizedExpression(expr)) {
      return this.exprToNodeId(expr.expression);
    }
    if (
      ts.isAsExpression(expr) ||
      ts.isTypeAssertionExpression(expr) ||
      ts.isSatisfiesExpression(expr) ||
      ts.isNonNullExpression(expr)
    ) {
      return this.exprToNodeId(expr.expression);
    }

    let sym: ts.Symbol | undefined;
    if (ts.isIdentifier(expr)) {
      sym = this.checker.getSymbolAtLocation(expr);
    } else if (ts.isPropertyAccessExpression(expr)) {
      sym =
        this.checker.getSymbolAtLocation(expr.name) ??
        this.checker.getSymbolAtLocation(expr);
    } else if (ts.isElementAccessExpression(expr)) {
      sym = this.propertySymbolForElementAccess(expr);
    } else {
      return undefined;
    }

    const vd = this.declarationForSymbol(sym);
    if (!vd) return undefined;
    return this.ensureFromValueDeclaration(vd);
  }

  private visitImportDeclaration(node: ts.ImportDeclaration): void {
    if (!node.importClause || node.importClause.isTypeOnly) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    const modSym = this.checker.getSymbolAtLocation(node.moduleSpecifier);
    if (!modSym) return;

    if (node.importClause.name && !node.importClause.isTypeOnly) {
      const importId = this.ensureImportBinding(node.importClause.name);
      const exportId = this.buildExportChain(modSym, "default");
      if (exportId && importId) this.addEdge(exportId, importId, "import");
    }

    if (
      node.importClause.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const el of node.importClause.namedBindings.elements) {
        if (el.isTypeOnly) continue;
        const importId = this.ensureImportBinding(el.name);
        const exportName = el.propertyName?.text ?? el.name.text;
        const exportId = this.buildExportChain(modSym, exportName);
        if (exportId && importId) this.addEdge(exportId, importId, "import");
      }
    } else if (
      node.importClause.namedBindings &&
      ts.isNamespaceImport(node.importClause.namedBindings)
    ) {
      const importId = this.ensureImportBinding(
        node.importClause.namedBindings.name,
      );
      const localSym = this.checker.getSymbolAtLocation(
        node.importClause.namedBindings.name,
      );
      if (!localSym) return;
      const aliased = this.checker.getAliasedSymbol(localSym);
      const expDecl = aliased.valueDeclaration;
      if (!expDecl) return;
      const expSf = expDecl.getSourceFile();
      if (!this.isUserSourceFile(expSf)) return;
      const exportId = this.ensureFromValueDeclaration(expDecl);
      if (exportId && importId) this.addEdge(exportId, importId, "import");
    }
  }

  private edgesFromCall(call: ts.CallExpression, lhsId?: string): void {
    const sig = this.checker.getResolvedSignature(call);
    if (!sig) return;
    const decl = sig.getDeclaration();
    if (!decl || !isCallableFunctionLike(decl)) {
      return;
    }
    if (!this.isUserSourceFile(decl.getSourceFile())) return;

    const ret = this.ensureReturnNode(decl);
    if (lhsId && ret) this.addEdge(ret, lhsId, "call-return");

    const params = decl.parameters;
    for (let i = 0; i < call.arguments.length; i++) {
      const arg = call.arguments[i];
      const param = params[i];
      if (arg === undefined || !param || !ts.isIdentifier(param.name)) continue;
      const argId = this.exprToNodeId(arg as ts.Expression);
      const paramId = this.ensureNamedDecl(param, "parameter");
      if (argId && paramId) this.addEdge(argId, paramId, "parameter-binding");
    }
  }

  private edgesFromObjectLiteral(
    obj: ts.ObjectLiteralExpression,
    vd: ts.VariableDeclaration,
  ): void {
    if (!ts.isIdentifier(vd.name)) return;
    const lhs = this.ensureNamedDecl(vd, "variable");
    if (!lhs) return;
    for (const p of obj.properties) {
      if (ts.isSpreadAssignment(p)) {
        const sid = this.exprToNodeId(p.expression);
        if (sid) this.addEdge(sid, lhs, "spread");
        continue;
      }
      if (ts.isPropertyAssignment(p)) {
        const pid = this.ensureFromValueDeclaration(p);
        const rhs = this.exprToNodeId(p.initializer);
        if (pid && rhs) {
          this.addEdge(rhs, pid, this.reasonForValueRead(p.initializer));
        }
        continue;
      }
      if (ts.isShorthandPropertyAssignment(p)) {
        const pid = this.ensureFromValueDeclaration(p);
        const rhs = this.exprToNodeId(p.name);
        if (pid && rhs) this.addEdge(rhs, pid, "assignment");
      }
    }
  }

  private visitExpressionStatement(node: ts.ExpressionStatement): void {
    const e = node.expression;
    if (ts.isCallExpression(e)) {
      this.edgesFromCall(e);
      return;
    }
    if (
      ts.isBinaryExpression(e) &&
      e.operatorToken.kind === ts.SyntaxKind.EqualsToken
    ) {
      const lhsId = this.exprToNodeId(e.left);
      if (!lhsId) return;
      if (ts.isCallExpression(e.right)) {
        this.edgesFromCall(e.right, lhsId);
        return;
      }
      const rhsId = this.exprToNodeId(e.right);
      if (rhsId) this.addEdge(rhsId, lhsId, this.reasonForValueRead(e.right));
    }
  }

  private visitVariableDeclaration(node: ts.VariableDeclaration): void {
    if (ts.isIdentifier(node.name)) {
      const lhs = this.ensureNamedDecl(node, "variable");
      const init = node.initializer;
      if (!init || !lhs) return;

      if (ts.isIdentifier(init)) {
        const rhs = this.exprToNodeId(init);
        if (rhs) this.addEdge(rhs, lhs, "assignment");
        return;
      }
      if (ts.isCallExpression(init)) {
        this.edgesFromCall(init, lhs);
        return;
      }
      const rhs = this.exprToNodeId(init);
      if (rhs) {
        this.addEdge(rhs, lhs, this.reasonForValueRead(init));
        return;
      }
      if (ts.isObjectLiteralExpression(init)) {
        this.edgesFromObjectLiteral(init, node);
      }
    } else if (ts.isObjectBindingPattern(node.name) && node.initializer) {
      const rhsId = this.exprToNodeId(node.initializer);
      if (!rhsId) return;
      for (const el of node.name.elements) {
        if (!ts.isBindingElement(el) || el.dotDotDotToken) continue;
        const bid = this.ensureBindingElement(el);
        if (bid) this.addEdge(rhsId, bid, "destructure");
      }
    }
  }

  private visitReturnStatement(node: ts.ReturnStatement): void {
    if (!node.expression) return;
    const fn = getEnclosingFunctionLike(node);
    if (!fn) return;
    const retId = this.ensureReturnNode(fn);
    const exId = this.exprToNodeId(node.expression);
    if (retId && exId) {
      this.addEdge(exId, retId, this.reasonForValueRead(node.expression));
    }
  }

  private visitPropertyDeclaration(node: ts.PropertyDeclaration): void {
    if (!node.initializer || !ts.isIdentifier(node.name)) return;
    const lhs = this.ensureNamedDecl(node, "property");
    const rhs = this.exprToNodeId(node.initializer);
    if (lhs && rhs) this.addEdge(rhs, lhs, "class-member");
  }

  private visitFunctionLike(fn: ts.FunctionLikeDeclaration): void {
    if (ts.isFunctionDeclaration(fn) && fn.name) {
      this.ensureNamedDecl(fn, "variable");
    }
    if (ts.isMethodDeclaration(fn) && ts.isIdentifier(fn.name)) {
      this.ensureNamedDecl(fn, "property");
    }
    for (const p of fn.parameters) {
      if (ts.isIdentifier(p.name)) {
        this.ensureNamedDecl(p, "parameter");
      }
    }
  }

  private visit(node: ts.Node): void {
    if (ts.isSourceFile(node)) {
      if (!this.isUserSourceFile(node)) return;
      ts.forEachChild(node, (c) => this.visit(c));
      return;
    }

    if (ts.isImportDeclaration(node)) this.visitImportDeclaration(node);
    else if (ts.isExpressionStatement(node))
      this.visitExpressionStatement(node);
    else if (ts.isVariableDeclaration(node))
      this.visitVariableDeclaration(node);
    else if (ts.isReturnStatement(node)) this.visitReturnStatement(node);
    else if (ts.isPropertyDeclaration(node))
      this.visitPropertyDeclaration(node);
    else if (
      ts.isFunctionDeclaration(node) ||
      ts.isArrowFunction(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionExpression(node)
    ) {
      this.visitFunctionLike(node);
    }

    ts.forEachChild(node, (c) => this.visit(c));
  }

  build(): void {
    for (const sf of this.program.getSourceFiles()) {
      if (!this.isUserSourceFile(sf)) continue;
      this.visit(sf);
    }
  }

  applySources(sources: AnySource[]): void {
    for (const s of sources) {
      const matches = [...this.nodes.values()].filter(
        (n) =>
          n.filePath === s.filePath &&
          n.line === s.line &&
          n.column === s.column &&
          n.name === s.name,
      );
      if (matches.length === 0) continue;

      const useReturnSlot =
        s.sourceKind === "untyped-return" ||
        (s.sourceKind === "explicit-any" &&
          matches.some((n) => n.kind === "return" && n.typeString === "any") &&
          matches.some((n) => n.kind !== "return" && n.typeString !== "any"));
      const target = useReturnSlot
        ? matches.find((n) => n.kind === "return")
        : matches.find((n) => n.kind !== "return");
      if (target) {
        target.isSource = true;
        target.sourceKind = s.sourceKind;
      }
    }
  }

  /**
   * Forward propagation (PLAN §5.3): along edges `from` → `to`, each source id tags reachable nodes in `infectedBy`.
   */
  propagate(): void {
    const sourceIds = [...this.nodes.values()]
      .filter((n) => n.isSource)
      .map((n) => n.id);
    for (const s of sourceIds) {
      const origin = this.nodes.get(s);
      if (!origin) continue;
      origin.infectedBy.add(s);
      const q: string[] = [s];
      while (q.length > 0) {
        const u = q.shift()!;
        for (const e of this.outgoing.get(u) ?? []) {
          const target = this.nodes.get(e.to);
          if (!target) continue;
          if (target.infectedBy.has(s)) continue;
          target.infectedBy.add(s);
          q.push(e.to);
        }
      }
    }
  }

  countInfectedBy(sourceId: string): number {
    let c = 0;
    for (const n of this.nodes.values()) {
      if (n.infectedBy.has(sourceId)) c += 1;
    }
    return c;
  }

  /** Count of graph nodes with non-empty `infectedBy` after `propagate()`. */
  getInfectedNodeCount(): number {
    let c = 0;
    for (const n of this.nodes.values()) {
      if (n.infectedBy.size > 0) c += 1;
    }
    return c;
  }

  getEdges(): GraphEdge[] {
    return this.edgeList;
  }

  /** Infected graph node ids per `any` source id (post-`propagate()`). */
  getInfectedNodeSetsPerSource(): Map<string, Set<string>> {
    const sourceIds = [...this.nodes.values()]
      .filter((n) => n.isSource && n.sourceKind !== undefined)
      .map((n) => n.id);
    const infectedNodesPerSource = new Map<string, Set<string>>();
    for (const sid of sourceIds) {
      const set = new Set<string>();
      for (const n of this.nodes.values()) {
        if (n.infectedBy.has(sid)) set.add(n.id);
      }
      infectedNodesPerSource.set(sid, set);
    }
    return infectedNodesPerSource;
  }

  /**
   * Greedy set-cover: repeatedly pick the `any` source that covers the most still-uncovered infected nodes.
   * Uses per-source infected sets so each pass is O(sources × min(|infected(s)|, |uncovered|)), not O(sources × |nodes|).
   */
  greedySetCoverPicks(blastRanked: SourceRanked[]): GreedyCoverPick[] {
    const universeSize = this.getInfectedNodeCount();
    if (universeSize === 0) return [];

    const meta = new Map<string, SourceRanked>();
    for (const r of blastRanked) {
      if (r.graphNodeId) meta.set(r.graphNodeId, r);
    }

    const universe = new Set<string>();
    for (const n of this.nodes.values()) {
      if (n.infectedBy.size > 0) universe.add(n.id);
    }

    const infectedNodesPerSource = this.getInfectedNodeSetsPerSource();
    const sourceIds = [...infectedNodesPerSource.keys()];

    const uncovered = new Set(universe);
    const picks: GreedyCoverPick[] = [];
    let cumulative = 0;
    let pickNum = 0;

    while (uncovered.size > 0) {
      let bestId: string | undefined;
      let bestGain = -1;

      for (const sid of sourceIds) {
        const infected = infectedNodesPerSource.get(sid)!;
        let gain = 0;
        if (infected.size <= uncovered.size) {
          for (const id of infected) {
            if (uncovered.has(id)) gain++;
          }
        } else {
          for (const id of uncovered) {
            if (infected.has(id)) gain++;
          }
        }

        if (gain > bestGain) {
          bestGain = gain;
          bestId = sid;
        } else if (gain === bestGain && gain > 0 && bestId !== undefined) {
          const b1 = meta.get(bestId)?.blastRadius ?? 0;
          const b2 = meta.get(sid)?.blastRadius ?? 0;
          if (b2 > b1) bestId = sid;
          else if (b2 === b1 && sid.localeCompare(bestId) < 0) bestId = sid;
        }
      }

      if (bestGain <= 0 || bestId === undefined) break;

      let newCov = 0;
      for (const id of infectedNodesPerSource.get(bestId)!) {
        if (uncovered.delete(id)) newCov++;
      }

      cumulative += newCov;
      pickNum++;
      const m = meta.get(bestId)!;
      const node = this.nodes.get(bestId)!;
      picks.push({
        pick: pickNum,
        graphNodeId: bestId,
        filePath: node.filePath,
        line: node.line,
        column: node.column,
        name: node.name,
        sourceKind: node.sourceKind!,
        blastRadius: m.blastRadius,
        blastRank: m.rank,
        newlyCoveredNodes: newCov,
        cumulativeCoveredNodes: cumulative,
        cumulativeCoveragePct: Math.round((100 * cumulative) / universeSize),
      });
    }

    return picks;
  }

  /**
   * Exact match on project-relative path (forward slashes) and reported identifier position.
   */
  getTraceHop(nodeId: string): TraceHop | undefined {
    const n = this.nodes.get(nodeId);
    if (!n) return undefined;
    return {
      nodeId: n.id,
      filePath: n.filePath,
      line: n.line,
      column: n.column,
      name: n.name,
      kind: n.kind,
    };
  }

  /** Source ids in `targetId`'s infection set that are graph `any` origins. */
  listInfectedSourceIds(targetId: string): string[] {
    const n = this.nodes.get(targetId);
    if (!n) return [];
    return [...n.infectedBy]
      .filter((id) => {
        const s = this.nodes.get(id);
        return Boolean(s?.isSource && s.sourceKind);
      })
      .sort((a, b) => a.localeCompare(b));
  }

  getAnySourceRow(nodeId: string):
    | {
        filePath: string;
        line: number;
        column: number;
        name: string;
        sourceKind: SourceKind;
      }
    | undefined {
    const n = this.nodes.get(nodeId);
    if (!n?.isSource || !n.sourceKind) return undefined;
    return {
      filePath: n.filePath,
      line: n.line,
      column: n.column,
      name: n.name,
      sourceKind: n.sourceKind,
    };
  }

  findNodeIdAtLocation(
    filePath: string,
    line: number,
    column: number,
  ): string | undefined {
    const norm = filePath.replace(/\\/g, "/");
    const matches = [...this.nodes.values()].filter(
      (n) => n.filePath === norm && n.line === line && n.column === column,
    );
    if (matches.length === 0) return undefined;
    matches.sort((a, b) => a.id.localeCompare(b.id));
    return matches[0]!.id;
  }

  rankSourcesByBlast(): SourceRanked[] {
    const rows = [...this.nodes.values()]
      .filter((n) => n.isSource && n.sourceKind !== undefined)
      .map((n) => ({
        n,
        blast: this.countInfectedBy(n.id),
      }))
      .sort(
        (a, b) =>
          b.blast - a.blast ||
          a.n.filePath.localeCompare(b.n.filePath) ||
          a.n.line - b.n.line ||
          a.n.column - b.n.column ||
          a.n.name.localeCompare(b.n.name),
      );

    return rows.map((row, i): SourceRanked => {
      const { n } = row;
      return {
        rank: i + 1,
        blastRadius: row.blast,
        graphNodeId: n.id,
        filePath: n.filePath,
        line: n.line,
        column: n.column,
        name: n.name,
        sourceKind: n.sourceKind!,
      };
    });
  }

  serialize(): SerializedGraph {
    const edgeKeys = new Set<string>();
    const edges: GraphEdge[] = [];
    for (const e of this.edgeList) {
      const k = `${e.from}\0${e.to}\0${e.reason}`;
      if (edgeKeys.has(k)) continue;
      edgeKeys.add(k);
      edges.push(e);
    }
    edges.sort(
      (a, b) =>
        a.from.localeCompare(b.from) ||
        a.to.localeCompare(b.to) ||
        a.reason.localeCompare(b.reason),
    );
    const nodes = [...this.nodes.values()]
      .map((n) => {
        const infectedBy = [...n.infectedBy].sort();
        const base = {
          id: n.id,
          filePath: n.filePath,
          line: n.line,
          column: n.column,
          name: n.name,
          kind: n.kind,
          typeString: n.typeString,
          isSource: n.isSource,
          infectedBy,
        };
        return n.sourceKind !== undefined
          ? { ...base, sourceKind: n.sourceKind }
          : base;
      })
      .sort(
        (a, b) =>
          a.filePath.localeCompare(b.filePath) ||
          a.line - b.line ||
          a.column - b.column ||
          a.id.localeCompare(b.id),
      );
    return { nodes, edges };
  }
}

export function buildSerializedGraph(
  program: ts.Program,
  projectRootAbs: string,
  sources: AnySource[],
): SerializedGraph {
  const b = new GraphBuilder(program, projectRootAbs);
  b.build();
  b.applySources(sources);
  b.propagate();
  return b.serialize();
}
