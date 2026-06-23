import type { GraphEdge, GraphNode, GraphPayload } from "../types";

/** In-memory graph state. Caller merges incremental fetches into this. */
export class GraphStore {
  rootId: string | null = null;
  nodes = new Map<string, GraphNode>();
  // Edge key = "a|b" with a < b (undirected)
  edges = new Map<string, GraphEdge>();
  expanded = new Set<string>(); // ids whose collaborators we've fetched

  static edgeKey(a: string, b: string): string {
    return a < b ? `${a}|${b}` : `${b}|${a}`;
  }

  merge(payload: GraphPayload): { newNodes: GraphNode[]; newEdges: GraphEdge[] } {
    if (!this.rootId) this.rootId = payload.root_id;
    const newNodes: GraphNode[] = [];
    const newEdges: GraphEdge[] = [];

    for (const n of payload.nodes) {
      const existing = this.nodes.get(n.id);
      if (!existing) {
        this.nodes.set(n.id, n);
        newNodes.push(n);
      } else if (n.depth < existing.depth) {
        // Prefer shorter discovery depth.
        this.nodes.set(n.id, { ...existing, depth: n.depth });
      }
    }
    for (const e of payload.edges) {
      const k = GraphStore.edgeKey(e.source, e.target);
      const prev = this.edges.get(k);
      if (!prev || e.weight > prev.weight) {
        this.edges.set(k, e);
        if (!prev) newEdges.push(e);
      }
    }
    return { newNodes, newEdges };
  }

  degreeOf(id: string): number {
    let d = 0;
    for (const e of this.edges.values()) {
      if (e.source === id || e.target === id) d++;
    }
    return d;
  }

  markExpanded(id: string) {
    this.expanded.add(id);
  }
}
