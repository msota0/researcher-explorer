import { useCallback, useMemo, useState } from "react";
import type { Core } from "cytoscape";
import { SearchBar } from "./components/SearchBar";
import { GraphView } from "./components/GraphView";
import { SidePanel } from "./components/SidePanel";
import { FilterPanel } from "./components/FilterPanel";
import { Toolbar } from "./components/Toolbar";
import { Legend } from "./components/Legend";
import { api } from "./lib/api";
import { GraphStore } from "./lib/graphStore";
import type { EncodingOpts, FilterOpts, GraphPayload, SearchHit } from "./types";

export default function App() {
  const [store] = useState(() => new GraphStore());
  const [payload, setPayload] = useState<GraphPayload | null>(null);
  const [cy, setCy] = useState<Core | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [expandingId, setExpandingId] = useState<string | null>(null);
  const [loadingRoot, setLoadingRoot] = useState(false);
  const [status, setStatus] = useState<string>("Pick a UM author to begin.");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const [encoding, setEncoding] = useState<EncodingOpts>({
    sizeBy: "degree",
    colorBy: "institution",
    borderBy: "h_index",
  });
  const [filters, setFilters] = useState<FilterOpts>({
    minWorks: 0,
    yearMin: null,
    yearMax: null,
    institutionContains: "",
  });

  const expanded = useMemo(() => store.expanded, [payload]);
  const selectedName = useMemo(
    () => (selected ? store.nodes.get(selected)?.data.display_name ?? null : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, payload],
  );

  // Pick from search bar -> reset graph and load just the seed + its direct
  // collaborators (depth 1). Deeper levels load only when the user expands a node.
  const onPick = useCallback(async (hit: SearchHit) => {
    store.rootId = null;
    store.nodes.clear();
    store.edges.clear();
    store.expanded.clear();
    setSelected(hit.id);
    setRightOpen(true);
    setLoadingRoot(true);
    setStatus(`Loading ${hit.display_name}…`);
    try {
      const p = await api.expand(hit.id, 1, 40);
      store.merge(p);
      store.markExpanded(hit.id);
      setPayload(p);
      setStatus(
        `Loaded ${p.nodes.length} authors, ${p.edges.length} collaborations. Select a node and Expand to grow the network.`,
      );
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    } finally {
      setLoadingRoot(false);
    }
  }, [store]);

  const onNodeClick = useCallback((id: string) => {
    setSelected(id);
    setRightOpen(true);
  }, []);

  // Fill in edges among the nodes already on screen — reveals the real network
  // around lazily-loaded "one-edge" nodes without expanding the graph outward.
  const [connecting, setConnecting] = useState(false);
  const onConnectVisible = useCallback(async () => {
    const ids = Array.from(store.nodes.keys());
    if (ids.length < 2 || connecting) return;
    setConnecting(true);
    setStatus(`Connecting ${ids.length} visible authors…`);
    try {
      const { edges } = await api.connectVisible(ids);
      const before = store.edges.size;
      store.merge({ root_id: store.rootId ?? ids[0], nodes: [], edges, truncated: false });
      setPayload({ root_id: store.rootId ?? ids[0], nodes: [], edges, truncated: false });
      setStatus(`Added ${store.edges.size - before} links between visible authors.`);
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    } finally {
      setConnecting(false);
    }
  }, [store, connecting]);

  const onNodeExpand = useCallback(
    async (id: string) => {
      if (store.expanded.has(id) || expandingId) return;
      setExpandingId(id);
      setStatus(`Expanding ${id}…`);
      try {
        const p = await api.expand(id, 1, 40);
        store.merge(p);
        store.markExpanded(id);
        setPayload({ ...p });
        setStatus(`Expanded ${id}. ${store.nodes.size} authors total.`);
      } catch (e: any) {
        setStatus(`Expand failed: ${e.message}`);
      } finally {
        setExpandingId(null);
      }
    },
    [store, expandingId],
  );

  return (
    <div className="relative h-full w-full">
      <header className="absolute top-0 left-0 right-0 z-20 px-3 py-2 flex items-center gap-3 bg-panel/70 backdrop-blur border-b border-line">
        <div className="text-sm font-semibold text-slate-200 mr-2">
          UM&nbsp;Researcher<span className="text-accent">·</span>Explorer
        </div>
        <SearchBar onPick={onPick} selectedName={selectedName} />
        <div className="text-xs text-slate-400 ml-auto truncate max-w-[35%]">
          {loadingRoot ? "Loading…" : status}
        </div>
      </header>

      <FilterPanel
        encoding={encoding}
        setEncoding={setEncoding}
        filters={filters}
        setFilters={setFilters}
        open={leftOpen}
        onToggle={() => setLeftOpen((v) => !v)}
      />

      <Toolbar
        cy={cy}
        store={store}
        onConnectVisible={onConnectVisible}
        connecting={connecting}
        selectedId={selected}
        onExpand={onNodeExpand}
        isExpanded={selected ? expanded.has(selected) : false}
        isExpanding={selected !== null && expandingId === selected}
      />
      <Legend encoding={encoding} />

      <GraphView
        store={store}
        lastPayload={payload}
        encoding={encoding}
        filters={filters}
        expandingId={expandingId}
        onNodeClick={onNodeClick}
        onNodeExpand={onNodeExpand}
        onReady={setCy}
      />

      <SidePanel
        authorId={selected}
        cy={cy}
        store={store}
        onClose={() => setSelected(null)}
        open={rightOpen}
        onToggle={() => setRightOpen((v) => !v)}
      />
    </div>
  );
}
