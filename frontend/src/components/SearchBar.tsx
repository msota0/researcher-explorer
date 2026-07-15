import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { BrowseItem, SearchHit } from "../types";

interface Props {
  onPick: (hit: SearchHit) => void;
  /** Name of the author currently selected elsewhere (e.g. a graph node). */
  selectedName?: string | null;
}

function browseToHit(it: BrowseItem): SearchHit {
  return {
    id: it.id,
    display_name: it.display_name,
    works_count: it.works_count,
    cited_by_count: it.cited_by_count,
    last_known_institution: it.last_known_institution_name
      ? { display_name: it.last_known_institution_name }
      : null,
  };
}

export function SearchBar({ onPick, selectedName }: Props) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  // The author chosen from the dropdown but not yet submitted.
  const pending = useRef<SearchHit | null>(null);
  // Suppress the search effect when we set `q` programmatically.
  const skipSearch = useRef(false);
  const ctrl = useRef<AbortController | null>(null);
  const t = useRef<number | null>(null);

  // Reflect the author selected elsewhere (e.g. clicking a graph node) in the bar.
  useEffect(() => {
    if (selectedName && selectedName !== q) {
      skipSearch.current = true;
      pending.current = null;
      setQ(selectedName);
      setHits([]);
      setOpen(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedName]);

  // Debounced search-as-you-type -> dropdown. Does NOT load the graph.
  useEffect(() => {
    if (t.current) window.clearTimeout(t.current);
    if (skipSearch.current) {
      skipSearch.current = false;
      return;
    }
    if (q.trim().length < 2) {
      setHits([]);
      setOpen(false);
      return;
    }
    t.current = window.setTimeout(async () => {
      ctrl.current?.abort();
      ctrl.current = new AbortController();
      setLoading(true);
      try {
        const r = await api.searchAuthors(q.trim(), 8);
        setHits(r);
        setOpen(true);
      } catch {
        // ignore
      } finally {
        setLoading(false);
      }
    }, 220);
    return () => {
      if (t.current) window.clearTimeout(t.current);
    };
  }, [q]);

  // Select a name from the dropdown: fill the bar, remember it, but don't load yet.
  const choose = (h: SearchHit) => {
    pending.current = h;
    skipSearch.current = true;
    setQ(h.display_name);
    setHits([]);
    setOpen(false);
  };

  // Submit: load the chosen author (or resolve the typed text to the best match).
  const submit = async () => {
    const text = q.trim();
    if (!text) return;
    setOpen(false);
    if (pending.current && pending.current.display_name === text) {
      onPick(pending.current);
      return;
    }
    setLoading(true);
    try {
      const r = await api.searchAuthors(text, 8);
      if (r.length > 0) {
        pending.current = r[0];
        onPick(r[0]);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  // Browse all: show the UM authors as a dropdown (toggles).
  const browseAll = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setLoading(true);
    try {
      const r = await api.browse(50, 0, "works_count");
      setHits(r.items.map(browseToHit));
      setOpen(true);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex items-center gap-2">
      <div className="relative w-[420px]">
        <input
          value={q}
          onChange={(e) => {
            pending.current = null;
            setQ(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
          }}
          onFocus={() => hits.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search a UM author (e.g. John Bentley)"
          className="w-full rounded-lg bg-panel border border-line px-3 py-2 text-sm placeholder:text-slate-500 focus:outline-none focus:border-accent/60"
        />
        {loading && (
          <div className="absolute right-3 top-2.5 text-xs text-slate-500">…</div>
        )}
        {open && hits.length > 0 && (
          <ul className="absolute z-20 mt-1 w-full max-h-80 overflow-auto rounded-lg bg-panel2 border border-line shadow-2xl">
            {hits.map((h) => (
              <li
                key={h.id}
                onMouseDown={() => choose(h)}
                className="px-3 py-2 cursor-pointer hover:bg-line/60 text-sm"
              >
                <div className="font-medium">{h.display_name}</div>
                <div className="text-xs text-slate-400">
                  {h.last_known_institution?.display_name || "—"} ·{" "}
                  {h.works_count} works · {h.cited_by_count.toLocaleString()} citations
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        onClick={submit}
        className="rounded-lg bg-accent/80 border border-accent/60 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-accent whitespace-nowrap"
      >
        Search
      </button>
      <button
        onMouseDown={(e) => e.preventDefault()}
        onClick={browseAll}
        className="rounded-lg bg-panel2 border border-line px-3 py-2 text-sm text-slate-300 hover:border-accent/60 hover:text-slate-100 whitespace-nowrap"
      >
        Browse all
      </button>
    </div>
  );
}
