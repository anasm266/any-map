import type { SourceKind } from "../types.js";
import type { EdgeReason, GraphNodeKind } from "./graph-types.js";

export interface TraceHop {
  nodeId: string;
  filePath: string;
  line: number;
  column: number;
  name: string;
  kind: GraphNodeKind;
}

export interface TracePathSegment {
  from: TraceHop;
  to: TraceHop;
  reason: EdgeReason;
}

export interface TracePathToSource {
  sourceId: string;
  filePath: string;
  line: number;
  column: number;
  name: string;
  sourceKind: SourceKind;
  /** Forward from source toward the traced symbol (first hop starts at source). */
  segments: TracePathSegment[];
}

export interface TraceReport {
  targetPath: string;
  loc: string;
  target: TraceHop;
  paths: TracePathToSource[];
}
