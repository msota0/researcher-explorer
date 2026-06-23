import { useEffect, useRef } from "react";
import cytoscape, { Core, ElementDefinition, EventObjectNode } from "cytoscape";
// @ts-ignore - no types ship for the layout
import fcose from "cytoscape-fcose";
import { GraphStore } from "../lib/graphStore";
import {
  borderWidth,
  edgeWidth,
  nodeColor,
  nodeSize,
} from "../lib/encoding";
import type { EncodingOpts, FilterOpts, GraphPayload } from "../types";

cytoscape.use(fcose);

// Shared layout config so the in-graph relayout and the toolbar "spread" button
// behave identically. Tuned looser than the defaults to keep dense graphs from
// collapsing into an unreadable cluster.
export const SPREAD_LAYOUT = {
  name: "fcose",
  // fcose defaults to fit:true, which re-centers/zooms the viewport on EVERY
  // run. During the streaming prefetch that makes the whole canvas drift
  // constantly — so we disable it and control fitting ourselves.
  fit: false,
  animate: false,
  randomize: false,
  nodeRepulsion: 14000,
  idealEdgeLength: 130,
  nodeSeparation: 140,
  gravity: 0.08,
  gravityRange: 4,
  packComponents: true,
  tile: true,
  nodeDimensionsIncludeLabels: true,
} as const;

// Below this zoom level we hide most labels so the canvas isn't a wall of text.
const LABEL_ZOOM_THRESHOLD = 0.55;

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

interface Props {
  store: GraphStore;
  lastPayload: GraphPayload | null;
  encoding: EncodingOpts;
  filters: FilterOpts;
  expandingId: string | null;
  onNodeClick: (id: string) => void;
  onNodeExpand: (id: string) => void;
  onReady: (cy: Core) => void;
}

export function GraphView({
  store,
  lastPayload,
  encoding,
  filters,
  expandingId,
  onNodeClick,
  onNodeExpand,
  onReady,
}: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const cyRef = useRef<Core | null>(null);
  const firstFitRef = useRef(false);
  const updateLabelsRef = useRef<() => void>(() => {});
  const layoutTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Init Cytoscape once.
  useEffect(() => {
    if (!hostRef.current || cyRef.current) return;
    const cy = cytoscape({
      container: hostRef.current,
      wheelSensitivity: 0.2,
      minZoom: 0.1,
      maxZoom: 4,
      style: [
        {
          selector: "node",
          style: {
            "background-color": "data(color)",
            "border-color": "#0b1220",
            "border-width": "data(borderW)",
            label: "data(label)",
            color: "#e2e8f0",
            "font-size": 10,
            "text-outline-color": "#0b1220",
            "text-outline-width": 2,
            "text-valign": "bottom",
            "text-margin-y": 4,
            width: "data(size)",
            height: "data(size)",
            "overlay-opacity": 0,
          },
        },
        {
          selector: "node.root",
          style: { "border-color": "#facc15", "border-width": 4 },
        },
        {
          selector: "node.expanding",
          style: { "border-color": "#7dd3fc", "border-style": "dashed" },
        },
        {
          selector: "node.dim",
          style: { opacity: 0.15, "text-opacity": 0 },
        },
        {
          // Zoomed-out / non-focused: keep the dot, drop the text.
          selector: "node.label-hidden",
          style: { "text-opacity": 0 },
        },
        {
          // Hover focus: everything outside the hovered neighborhood recedes.
          selector: "node.faded",
          style: { opacity: 0.1, "text-opacity": 0 },
        },
        {
          selector: "node:selected",
          style: { "border-color": "#7dd3fc", "border-width": 4 },
        },
        {
          selector: "edge",
          style: {
            "line-color": "#334155",
            width: "data(width)",
            "curve-style": "haystack",
            opacity: 0.55,
            "overlay-opacity": 0,
          },
        },
        {
          selector: "edge.dim",
          style: { opacity: 0.05 },
        },
        {
          selector: "edge.faded",
          style: { opacity: 0.04 },
        },
        {
          selector: "edge:selected",
          style: { "line-color": "#7dd3fc", opacity: 0.9 },
        },
      ],
    });
    cyRef.current = cy;
    onReady(cy);

    // Show labels only when zoomed in close enough, or for always-relevant
    // nodes (root / selected). Keeps a large graph from being all text.
    const updateLabels = () => {
      const show = cy.zoom() >= LABEL_ZOOM_THRESHOLD;
      cy.batch(() => {
        cy.nodes().forEach((nd) => {
          const keep = show || nd.hasClass("root") || nd.selected();
          nd.toggleClass("label-hidden", !keep);
        });
      });
    };
    updateLabelsRef.current = updateLabels;
    cy.on("zoom", debounce(updateLabels, 120));

    cy.on("tap", "node", (evt: EventObjectNode) => {
      onNodeClick(evt.target.id());
      updateLabels();
    });
    cy.on("dbltap", "node", (evt: EventObjectNode) => {
      onNodeExpand(evt.target.id());
    });
    cy.on("tap", (evt) => {
      if (evt.target === cy) cy.elements().unselect();
    });

    // Hover-to-focus: fade everything outside the hovered node's neighborhood
    // and reveal its (otherwise hidden) labels so dense regions stay readable.
    cy.on("mouseover", "node", (evt: EventObjectNode) => {
      const nb = evt.target.closedNeighborhood();
      cy.elements().not(nb).addClass("faded");
      nb.removeClass("faded");
      nb.nodes().removeClass("label-hidden");
    });
    cy.on("mouseout", "node", () => {
      cy.elements().removeClass("faded");
      updateLabels();
    });

    return () => {
      cy.destroy();
      cyRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync nodes/edges from the store whenever new data arrives.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !lastPayload) return;

    const adds: ElementDefinition[] = [];
    for (const n of store.nodes.values()) {
      if (cy.getElementById(n.id).nonempty()) continue;
      const degree = store.degreeOf(n.id);
      adds.push({
        group: "nodes",
        data: {
          id: n.id,
          label: n.data.display_name,
          depth: n.depth,
          color: nodeColor(n.data, n.depth, encoding.colorBy),
          size: nodeSize(n.data, degree, encoding.sizeBy),
          borderW: borderWidth(n.data, encoding.borderBy),
          author: n.data,
        },
      });
    }
    for (const e of store.edges.values()) {
      const id = `${e.source}__${e.target}`;
      if (cy.getElementById(id).nonempty()) continue;
      adds.push({
        group: "edges",
        data: {
          id,
          source: e.source,
          target: e.target,
          weight: e.weight,
          width: edgeWidth(e.weight),
          shared: e.shared_work_ids,
        },
      });
    }
    if (adds.length) {
      cy.add(adds);
      // Mark root
      if (store.rootId) cy.getElementById(store.rootId).addClass("root");
      // Debounce the relayout: the background prefetch streams nodes in bursts,
      // and re-packing on every burst both thrashes the view and squeezes nodes
      // together. Wait for additions to settle, then lay out once.
      if (layoutTimerRef.current) clearTimeout(layoutTimerRef.current);
      layoutTimerRef.current = setTimeout(() => {
        const layout = cy.layout({ ...SPREAD_LAYOUT } as any);
        layout.one("layoutstop", () => {
          updateLabelsRef.current();
          if (!firstFitRef.current) {
            cy.fit(undefined, 60);
            firstFitRef.current = true;
          }
        });
        layout.run();
      }, 350);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastPayload]);

  // Re-style when encoding changes (no relayout).
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().forEach((nd) => {
      const a = nd.data("author");
      const depth = nd.data("depth");
      const deg = nd.degree(false);
      nd.data("color", nodeColor(a, depth, encoding.colorBy));
      nd.data("size", nodeSize(a, deg, encoding.sizeBy));
      nd.data("borderW", borderWidth(a, encoding.borderBy));
    });
  }, [encoding]);

  // Apply filters (dim non-matching).
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.batch(() => {
      cy.nodes().forEach((nd) => {
        const a = nd.data("author");
        const inst = a.last_known_institution?.display_name || "";
        let ok = a.works_count >= filters.minWorks;
        if (ok && filters.institutionContains) {
          ok = inst
            .toLowerCase()
            .includes(filters.institutionContains.toLowerCase());
        }
        nd.toggleClass("dim", !ok);
      });
      cy.edges().forEach((ed) => {
        const dim = ed.source().hasClass("dim") || ed.target().hasClass("dim");
        ed.toggleClass("dim", dim);
      });
    });
  }, [filters]);

  // Per-node expanding spinner indicator (border style).
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes(".expanding").removeClass("expanding");
    if (expandingId) {
      const n = cy.getElementById(expandingId);
      if (n.nonempty()) n.addClass("expanding");
    }
  }, [expandingId]);

  return <div ref={hostRef} className="cy-host" />;
}
