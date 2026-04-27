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

export class GraphBuilder {
  private readonly checker: ts.TypeChecker;
  private readonly nodes = new Map<string, GraphNodeMutable>();
  private readonly edgeList: GraphEdge[] = [];
  /** Type flows `from` → `to` (PLAN §5.2). */
  private readonly outgoing = new Map<string, GraphEdge[]>();

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
    if (!ts.isIdentifier(expr)) return undefined;
    const sym = this.checker.getSymbolAtLocation(expr);
    const vd =
      sym?.declarations?.find(
        (decl) =>
          ts.isImportClause(decl) ||
          ts.isImportSpecifier(decl) ||
          ts.isNamespaceImport(decl) ||
          ts.isImportEqualsDeclaration(decl),
      ) ?? sym?.valueDeclaration;
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
    if (
      node.importClause.namedBindings &&
      ts.isNamedImports(node.importClause.namedBindings)
    ) {
      for (const el of node.importClause.namedBindings.elements) {
        if (!el.isTypeOnly) locals.push(el.name);
      }
    } else if (
      node.importClause.namedBindings &&
      ts.isNamespaceImport(node.importClause.namedBindings)
    ) {
      locals.push(node.importClause.namedBindings.name);
    }

    for (const local of locals) {
      const importId = this.ensureImportBinding(local);
      const localSym = this.checker.getSymbolAtLocation(local);
      if (!localSym) continue;
      const aliased = this.checker.getAliasedSymbol(localSym);
      const expDecl = aliased.valueDeclaration;
      if (!expDecl) continue;
      const expSf = expDecl.getSourceFile();
      if (!this.isUserSourceFile(expSf)) continue;
      const exportId = this.ensureFromValueDeclaration(expDecl);
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

  private visitExpressionStatement(node: ts.ExpressionStatement): void {
    const e = node.expression;
    if (ts.isCallExpression(e)) {
      this.edgesFromCall(e);
      return;
    }
    if (
      ts.isBinaryExpression(e) &&
      e.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      ts.isCallExpression(e.right)
    ) {
      const lhsId = ts.isIdentifier(e.left)
        ? this.exprToNodeId(e.left)
        : undefined;
      this.edgesFromCall(e.right, lhsId);
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
      // `untyped-return` is reported at the function/binding name, but flow to callers goes
      // from the synthetic `return` slot (`ensureReturnNode`), not the value node for `f`.
      const useReturnSlot = s.sourceKind === "untyped-return";
      for (const n of this.nodes.values()) {
        if (
          n.filePath === s.filePath &&
          n.line === s.line &&
          n.column === s.column &&
          n.name === s.name &&
          (useReturnSlot ? n.kind === "return" : n.kind !== "return")
        ) {
          n.isSource = true;
          n.sourceKind = s.sourceKind;
          break;
        }
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
