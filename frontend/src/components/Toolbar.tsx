import type { Core } from "cytoscape";
import { GraphStore } from "../lib/graphStore";
import { SPREAD_LAYOUT } from "./GraphView";

interface Props {
  cy: Core | null;
  store: GraphStore;
  onConnectVisible?: () => void;
  connecting?: boolean;
  // When an author is selected, the "Expand collaborators" action lives here in
  // the footer (instead of being embedded in the right side panel).
  selectedId?: string | null;
  onExpand?: (id: string) => void;
  isExpanded?: boolean;
  isExpanding?: boolean;
}

export function Toolbar({
  cy,
  store,
  onConnectVisible,
  connecting,
  selectedId,
  onExpand,
  isExpanded,
  isExpanding,
}: Props) {
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
    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 flex flex-wrap gap-2 items-stretch justify-center max-w-[90%]">
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

      {/* Navigate (pan) */}
      <Group label="Navigate">
        <Btn onClick={() => pan(-1, 0)} title="Pan left">
          ←
        </Btn>
        <Btn onClick={() => pan(0, -1)} title="Pan up">
          ↑
        </Btn>
        <Btn onClick={() => pan(0, 1)} title="Pan down">
          ↓
        </Btn>
        <Btn onClick={() => pan(1, 0)} title="Pan right">
          →
        </Btn>
      </Group>

      {/* Layout + export */}
      <Group label="Graph">
        {onConnectVisible && (
          <Btn
            onClick={onConnectVisible}
            title="Draw co-authorship links among the authors already on screen (adds no new nodes)"
          >
            {connecting ? "connecting…" : "⇄ connect"}
          </Btn>
        )}
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

      {/* Selected author — expand action moved out of the right panel */}
      {selectedId && onExpand && (
        <Group label="Author">
          <Btn
            onClick={() => onExpand(selectedId)}
            disabled={isExpanded || isExpanding}
            title="Load this author's collaborators into the graph"
          >
            {isExpanding
              ? "Expanding…"
              : isExpanded
                ? "Already expanded"
                : "⊕ Expand collaborators"}
          </Btn>
        </Group>
      )}
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
      <div className="flex flex-wrap gap-1 justify-center">{children}</div>
    </div>
  );
}

function Btn({
  onClick,
  children,
  title,
  disabled,
}: {
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className="min-w-[34px] px-2 h-7 rounded bg-panel2 border border-line hover:bg-line/60 disabled:opacity-40 disabled:cursor-not-allowed text-xs text-slate-200"
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
