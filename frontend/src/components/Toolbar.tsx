import type { Core } from "cytoscape";
import { GraphStore } from "../lib/graphStore";
import { SPREAD_LAYOUT } from "./GraphView";

interface Props {
  cy: Core | null;
  store: GraphStore;
  // The side panel (380px) opens over the right edge; shift the toolbar clear
  // of it so the controls stay reachable while inspecting an author.
  panelOpen?: boolean;
}

export function Toolbar({ cy, store, panelOpen }: Props) {
  const zoom = (factor: number) => {
    if (!cy) return;
    cy.zoom({
      level: cy.zoom() * factor,
      renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 },
    });
  };
  const fit = () => cy?.fit(undefined, 40);
  const center = () => cy?.center();

  // Pan the viewport by a fixed step (rendered pixels). An arrow pointing a
  // direction moves the view that way, i.e. shifts the graph the opposite way.
  const PAN_STEP = 120;
  const pan = (dx: number, dy: number) =>
    cy?.panBy({ x: -dx * PAN_STEP, y: -dy * PAN_STEP });

  // Re-run the spreading layout on demand — handy when nodes drift into a
  // cluster after a few expansions.
  const relayout = () => {
    if (!cy) return;
    const layout = cy.layout({ ...SPREAD_LAYOUT } as any);
    layout.one("layoutstop", () => cy.fit(undefined, 60));
    layout.run();
  };

  const exportPng = () => {
    if (!cy) return;
    const png = cy.png({ full: true, scale: 2, bg: "#0b1220" });
    download(png, "graph.png");
  };

  const exportJson = () => {
    const payload = {
      root_id: store.rootId,
      nodes: Array.from(store.nodes.values()),
      edges: Array.from(store.edges.values()),
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    download(URL.createObjectURL(blob), "graph.json");
  };

  return (
    <div
      className="absolute top-16 z-10 flex flex-col gap-2 items-end transition-[right] duration-200"
      style={{ right: panelOpen ? 392 : 12 }}
    >
      {/* Zoom */}
      <Group label="Zoom">
        <Btn onClick={() => zoom(1.25)} title="Zoom in">
          +
        </Btn>
        <Btn onClick={() => zoom(0.8)} title="Zoom out">
          −
        </Btn>
        <Btn onClick={fit} title="Fit graph to view">
          fit
        </Btn>
        <Btn onClick={center} title="Center graph">
          ⊙
        </Btn>
      </Group>

      {/* Navigate (pan) — arranged as a directional pad */}
      <Group label="Navigate">
        <div className="grid grid-cols-3 grid-rows-2 gap-1">
          <span />
          <Btn onClick={() => pan(0, -1)} title="Pan up">
            ↑
          </Btn>
          <span />
          <Btn onClick={() => pan(-1, 0)} title="Pan left">
            ←
          </Btn>
          <Btn onClick={() => pan(0, 1)} title="Pan down">
            ↓
          </Btn>
          <Btn onClick={() => pan(1, 0)} title="Pan right">
            →
          </Btn>
        </div>
      </Group>

      {/* Layout + export */}
      <Group label="Graph">
        <Btn onClick={relayout} title="Re-spread the nodes">
          ⤢ spread
        </Btn>
        <Btn onClick={exportPng} title="Export PNG">
          PNG
        </Btn>
        <Btn onClick={exportJson} title="Export JSON">
          JSON
        </Btn>
      </Group>
    </div>
  );
}

function Group({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-panel/90 backdrop-blur border border-line rounded-lg p-1.5">
      <div className="text-[9px] uppercase tracking-wide text-slate-500 px-1 pb-1">
        {label}
      </div>
      <div className="flex flex-wrap gap-1 justify-end">{children}</div>
    </div>
  );
}

function Btn({
  onClick,
  children,
  title,
}: {
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="min-w-[34px] px-2 h-7 rounded bg-panel2 border border-line hover:bg-line/60 text-xs text-slate-200"
    >
      {children}
    </button>
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
