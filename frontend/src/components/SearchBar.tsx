import { useEffect, useRef, useState } from "react";
import { api } from "../lib/api";
import type { SearchHit } from "../types";

interface Props {
  onPick: (hit: SearchHit) => void;
}

export function SearchBar({ onPick }: Props) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ctrl = useRef<AbortController | null>(null);
  const t = useRef<number | null>(null);

  useEffect(() => {
    if (t.current) window.clearTimeout(t.current);
    if (q.trim().length < 2) {
      setHits([]);
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

  return (
    <div className="relative w-[420px]">
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
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
              onMouseDown={() => {
                onPick(h);
                setOpen(false);
                setQ(h.display_name);
              }}
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
  );
}
