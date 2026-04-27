import type { SourceKind } from "../types.js";

export type GraphNodeKind =
  | "variable"
  | "parameter"
  | "return"
  | "property"
  | "import-binding"
  | "export-binding";

export type EdgeReason =
  | "assignment"
  | "call-return"
  | "destructure"
  | "import"
  | "re-export"
  | "property-access"
  | "parameter-binding"
  | "class-member"
  | "spread"
  | "type-alias"
  | "index-access";

/** Mutable graph node while building / future propagation (m4). */
export interface GraphNodeMutable {
  id: string;
  filePath: string;
  line: number;
  column: number;
  name: string;
  kind: GraphNodeKind;
  typeString: string;
  isSource: boolean;
  sourceKind?: SourceKind;
  infectedBy: Set<string>;
}

export interface GraphEdge {
  from: string;
  to: string;
  reason: EdgeReason;
}

/** JSON-safe snapshot for `--dump-graph`. */
export interface SerializedGraphNode {
  id: string;
  filePath: string;
  line: number;
  column: number;
  name: string;
  kind: GraphNodeKind;
  typeString: string;
  isSource: boolean;
  sourceKind?: SourceKind;
  infectedBy: string[];
}

/** JSON-safe snapshot for `--dump-graph`. */
export interface SerializedGraph {
  nodes: SerializedGraphNode[];
  edges: GraphEdge[];
}
