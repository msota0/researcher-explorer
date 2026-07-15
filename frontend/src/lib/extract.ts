import type { Core } from "cytoscape";
import type { GraphStore } from "./graphStore";
import type { GraphEdge, GraphNode } from "../types";

export interface EgoNetwork {
  center_id: string;
  center_name: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * The induced sub-network around one author: the author, their currently
 * loaded collaborators, and every edge among that set. This is exactly the
 * neighborhood the graph highlights on hover/spotlight.
 */
export function egoNetwork(store: GraphStore, centerId: string): EgoNetwork {
  const ids = new Set<string>([centerId]);
  for (const e of store.edges.values()) {
    if (e.source === centerId) ids.add(e.target);
    else if (e.target === centerId) ids.add(e.source);
  }
  const nodes: GraphNode[] = [];
  ids.forEach((id) => {
    const n = store.nodes.get(id);
    if (n) nodes.push(n);
  });
  const edges = Array.from(store.edges.values()).filter(
    (e) => ids.has(e.source) && ids.has(e.target),
  );
  return {
    center_id: centerId,
    center_name: store.nodes.get(centerId)?.data.display_name ?? centerId,
    nodes,
    edges,
  };
}

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "author"
  );
}

function download(href: string, name: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Download the author's sub-network as JSON (nodes + edges). */
export function exportEgoJson(store: GraphStore, centerId: string) {
  const net = egoNetwork(store, centerId);
  const blob = new Blob([JSON.stringify(net, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  download(url, `${slug(net.center_name)}-network.json`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Download a PNG of just the author's sub-network. Temporarily hides everything
 * outside it, fits the view, snapshots, then restores the previous viewport.
 */
export function exportEgoPng(cy: Core, store: GraphStore, centerId: string) {
  const net = egoNetwork(store, centerId);
  const ids = new Set(net.nodes.map((n) => n.id));
  const inNet = cy.nodes().filter((n) => ids.has(n.id()));
  const sub = inNet.union(inNet.edgesWith(inNet));
  const others = cy.elements().not(sub);

  const prevPan = { ...cy.pan() };
  const prevZoom = cy.zoom();
  others.style("display", "none");
  cy.fit(sub, 40);
  const png = cy.png({ full: false, scale: 2, bg: "#0b1220" });
  others.removeStyle("display");
  cy.viewport({ zoom: prevZoom, pan: prevPan });

  download(png, `${slug(net.center_name)}-network.png`);
}
