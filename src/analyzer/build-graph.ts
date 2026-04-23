import ts from "typescript";
import type { AnySource } from "../types.js";
import type {
  EdgeReason,
  GraphEdge,
  GraphNodeKind,
  GraphNodeMutable,
  SerializedGraph,
} from "./graph-types.js";
import { isFromNodeModulesOrDts, toProjectRelativePath } from "./load-project.js";
import { makeNodeId } from "./node-id.js";

function getEnclosingFunctionLike(node: ts.Node): ts.FunctionLikeDeclaration | undefined {
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

export class GraphBuilder {
  private readonly checker: ts.TypeChecker;
  private readonly nodes = new Map<string, GraphNodeMutable>();
  private readonly edgeList: GraphEdge[] = [];

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
    this.edgeList.push({ from, to, reason });
  }

  private typeStringAt(node: ts.Node): string {
    const t = this.checker.getTypeAtLocation(node);
    return this.checker.typeToString(t, undefined, ts.TypeFormatFlags.NoTruncation);
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

  private ensureFromValueDeclaration(vd: ts.Declaration): string | undefined {
    if (ts.isImportSpecifier(vd) && ts.isIdentifier(vd.name)) {
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

  private returnAnchor(
    fn: ts.FunctionLikeDeclaration,
  ): { filePath: string; line: number; column: number; displayName: string } | undefined {
    const sf = fn.getSourceFile();
    const filePath = this.rel(sf);
    const vp = fn.parent;
    if (ts.isVariableDeclaration(vp) && ts.isIdentifier(vp.name)) {
      const pos = vp.name.getStart(sf, false);
      const { line, character } = sf.getLineAndCharacterOfPosition(pos);
      return { filePath, line: line + 1, column: character + 1, displayName: vp.name.text };
    }
    if (
      ts.isPropertyDeclaration(vp) &&
      ts.isIdentifier(vp.name) &&
      (ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))
    ) {
      const pos = vp.name.getStart(sf, false);
      const { line, character } = sf.getLineAndCharacterOfPosition(pos);
      return { filePath, line: line + 1, column: character + 1, displayName: vp.name.text };
    }
    if (ts.isFunctionDeclaration(fn) && fn.name) {
      const pos = fn.name.getStart(sf, false);
      const { line, character } = sf.getLineAndCharacterOfPosition(pos);
      return { filePath, line: line + 1, column: character + 1, displayName: fn.name.text };
    }
    if (ts.isMethodDeclaration(fn) && ts.isIdentifier(fn.name)) {
      const pos = fn.name.getStart(sf, false);
      const { line, character } = sf.getLineAndCharacterOfPosition(pos);
      return { filePath, line: line + 1, column: character + 1, displayName: fn.name.text };
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
      const typeString = this.checker.typeToString(rt, undefined, ts.TypeFormatFlags.NoTruncation);
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
    if (!ts.isIdentifier(expr)) return undefined;
    const sym = this.checker.getSymbolAtLocation(expr);
    const vd = sym?.valueDeclaration;
    if (!vd) return undefined;
    return this.ensureFromValueDeclaration(vd);
  }

  private visitImportDeclaration(node: ts.ImportDeclaration): void {
    if (!node.importClause || node.importClause.isTypeOnly) return;
    if (!ts.isStringLiteral(node.moduleSpecifier)) return;
    const modSym = this.checker.getSymbolAtLocation(node.moduleSpecifier);
    if (!modSym) return;

    const locals: ts.Identifier[] = [];
    if (node.importClause.name && !node.importClause.isTypeOnly) {
      locals.push(node.importClause.name);
    }
    if (node.importClause.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
      for (const el of node.importClause.namedBindings.elements) {
        if (!el.isTypeOnly) locals.push(el.name);
      }
    }

    for (const local of locals) {
      const localSym = this.checker.getSymbolAtLocation(local);
      if (!localSym) continue;
      const aliased = this.checker.getAliasedSymbol(localSym);
      const expDecl = aliased.valueDeclaration;
      if (!expDecl) continue;
      const expSf = expDecl.getSourceFile();
      if (!this.isUserSourceFile(expSf)) continue;
      const exportId = this.ensureFromValueDeclaration(expDecl);
      const importId = this.ensureImportBinding(local);
      if (exportId && importId) this.addEdge(exportId, importId, "import");
    }
  }

  private edgesFromCall(call: ts.CallExpression, lhsId?: string): void {
    const sig = this.checker.getResolvedSignature(call);
    if (!sig) return;
    const decl = sig.getDeclaration();
    if (
      !decl ||
      (!ts.isFunctionDeclaration(decl) &&
        !ts.isMethodDeclaration(decl) &&
        !ts.isFunctionExpression(decl) &&
        !ts.isArrowFunction(decl))
    ) {
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
      }
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
    if (retId && exId) this.addEdge(exId, retId, "assignment");
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
    else if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      this.edgesFromCall(node.expression);
    } else if (ts.isVariableDeclaration(node)) this.visitVariableDeclaration(node);
    else if (ts.isReturnStatement(node)) this.visitReturnStatement(node);
    else if (ts.isPropertyDeclaration(node)) this.visitPropertyDeclaration(node);
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
      for (const n of this.nodes.values()) {
        if (
          n.filePath === s.filePath &&
          n.line === s.line &&
          n.column === s.column &&
          n.name === s.name &&
          n.kind !== "return"
        ) {
          n.isSource = true;
          n.sourceKind = s.sourceKind;
          break;
        }
      }
    }
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
        return n.sourceKind !== undefined ? { ...base, sourceKind: n.sourceKind } : base;
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
  return b.serialize();
}
