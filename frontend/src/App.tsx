import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Core } from "cytoscape";
import { SearchBar } from "./components/SearchBar";
import { GraphView } from "./components/GraphView";
import { SidePanel } from "./components/SidePanel";
import { FilterPanel } from "./components/FilterPanel";
import { Toolbar } from "./components/Toolbar";
import { Legend } from "./components/Legend";
import { Directory } from "./components/Directory";
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
  const [showDirectory, setShowDirectory] = useState(false);
  const prefetchedRef = useRef<Set<string>>(new Set());

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

  // Pick from search bar -> reset graph and load depth 1 around the picked author.
  const onPick = useCallback(async (hit: SearchHit) => {
    store.rootId = null;
    store.nodes.clear();
    store.edges.clear();
    store.expanded.clear();
    prefetchedRef.current.clear();
    setSelected(hit.id);
    setLoadingRoot(true);
    setStatus(`Loading ${hit.display_name}…`);
    try {
      const p = await api.expand(hit.id, 1, 40);
      store.merge(p);
      store.markExpanded(hit.id);
      setPayload(p);
      setStatus(
        `Loaded ${p.nodes.length} authors, ${p.edges.length} collaborations. Prefetching depth 2…`,
      );
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    } finally {
      setLoadingRoot(false);
    }
  }, [store]);

  // Background prefetch: depth-1 nodes' collaborators (i.e. extend toward depth 2).
  // Throttled to avoid hammering OpenAlex.
  useEffect(() => {
    if (!payload || !store.rootId) return;
    const queue: string[] = [];
    for (const n of store.nodes.values()) {
      if (n.depth === 1 && !store.expanded.has(n.id) && !prefetchedRef.current.has(n.id)) {
        queue.push(n.id);
      }
    }
    if (queue.length === 0) return;
    let cancelled = false;

    (async () => {
      for (const id of queue) {
        if (cancelled) return;
        prefetchedRef.current.add(id);
        try {
          const p = await api.expand(id, 1, 25);
          store.merge(p);
          store.markExpanded(id);
          setPayload({ ...p }); // trigger sync; GraphView dedupes
        } catch {
          // best-effort
        }
        await new Promise((r) => setTimeout(r, 350));
      }
      if (!cancelled) setStatus(`Graph complete. ${store.nodes.size} authors loaded.`);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store.rootId]);

  const onNodeClick = useCallback((id: string) => {
    setSelected(id);
  }, []);

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
        <SearchBar onPick={onPick} />
        <button
          onClick={() => setShowDirectory(true)}
          className="rounded-lg bg-panel2 border border-line px-3 py-2 text-sm text-slate-300 hover:border-accent/60 hover:text-slate-100 whitespace-nowrap"
        >
          Browse all
        </button>
        <div className="text-xs text-slate-400 ml-auto truncate max-w-[35%]">
          {loadingRoot ? "Loading…" : status}
        </div>
      </header>

      {showDirectory && (
        <Directory onPick={onPick} onClose={() => setShowDirectory(false)} />
      )}

      <FilterPanel
        encoding={encoding}
        setEncoding={setEncoding}
        filters={filters}
        setFilters={setFilters}
      />

      <Toolbar cy={cy} store={store} panelOpen={selected !== null} />
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
        onClose={() => setSelected(null)}
        onExpand={onNodeExpand}
        isExpanded={selected ? expanded.has(selected) : false}
        isExpanding={selected !== null && expandingId === selected}
      />
    </div>
  );
}
