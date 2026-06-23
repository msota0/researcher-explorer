import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { BrowseItem, BrowseSort, SearchHit } from "../types";

interface Props {
  onPick: (hit: SearchHit) => void;
  onClose: () => void;
}

const PAGE = 50;

const SORTS: { value: BrowseSort; label: string }[] = [
  { value: "works_count", label: "Most works" },
  { value: "cited_by_count", label: "Most cited" },
  { value: "h_index", label: "Highest h-index" },
  { value: "display_name", label: "Name (A–Z)" },
];

export function Directory({ onPick, onClose }: Props) {
  const [items, setItems] = useState<BrowseItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<BrowseSort>("works_count");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);

  const searching = q.trim().length >= 2;

  // Browse mode: paginated + sorted listing of the whole dataset.
  useEffect(() => {
    if (searching) return;
    let cancelled = false;
    setLoading(true);
    api
      .browse(PAGE, offset, sort)
      .then((r) => {
        if (cancelled) return;
        setItems(r.items);
        setTotal(r.total);
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [offset, sort, searching]);

  // Search mode: debounced name lookup across the dataset.
  useEffect(() => {
    if (!searching) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      setLoading(true);
      api
        .searchAuthors(q.trim(), 50)
        .then((hits) => {
          if (cancelled) return;
          setItems(
            hits.map((h) => ({
              id: h.id,
              display_name: h.display_name,
              works_count: h.works_count,
              cited_by_count: h.cited_by_count,
              h_index: (h as any).h_index ?? null,
              last_known_institution_name:
                h.last_known_institution?.display_name ?? null,
            })),
          );
          setTotal(hits.length);
        })
        .finally(() => !cancelled && setLoading(false));
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [q, searching]);

  const pick = (it: BrowseItem) => {
    onPick({
      id: it.id,
      display_name: it.display_name,
      works_count: it.works_count,
      cited_by_count: it.cited_by_count,
      last_known_institution: it.last_known_institution_name
        ? { display_name: it.last_known_institution_name }
        : null,
    });
    onClose();
  };

  const page = Math.floor(offset / PAGE) + 1;
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center bg-black/60 backdrop-blur-sm p-6"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-4xl mt-10 max-h-[85vh] flex flex-col rounded-xl bg-panel border border-line shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* header */}
        <div className="flex items-center gap-3 p-4 border-b border-line">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">
              UM Author Directory
            </h2>
            <div className="text-xs text-slate-500">
              {searching
                ? `${items.length} match${items.length === 1 ? "" : "es"}`
                : `${total.toLocaleString()} University of Mississippi authors`}
            </div>
          </div>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Filter by name…"
            className="ml-auto w-64 rounded-lg bg-panel2 border border-line px-3 py-1.5 text-sm placeholder:text-slate-500 focus:outline-none focus:border-accent/60"
          />
          <select
            value={sort}
            disabled={searching}
            onChange={(e) => {
              setSort(e.target.value as BrowseSort);
              setOffset(0);
            }}
            className="rounded-lg bg-panel2 border border-line px-2 py-1.5 text-sm disabled:opacity-40 focus:outline-none focus:border-accent/60"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200 text-sm px-1"
          >
            ✕
          </button>
        </div>

        {/* table */}
        <div className="overflow-y-auto flex-1">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-panel2 text-slate-500 text-xs uppercase tracking-wider">
              <tr>
                <th className="text-left font-medium px-4 py-2">Author</th>
                <th className="text-left font-medium px-4 py-2">Affiliation</th>
                <th className="text-right font-medium px-4 py-2">Works</th>
                <th className="text-right font-medium px-4 py-2">Citations</th>
                <th className="text-right font-medium px-4 py-2 pr-4">h-index</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr
                  key={it.id}
                  onClick={() => pick(it)}
                  className="border-t border-line/50 hover:bg-line/40 cursor-pointer"
                >
                  <td className="px-4 py-2 font-medium text-slate-200">
                    {it.display_name}
                  </td>
                  <td className="px-4 py-2 text-slate-400 text-xs">
                    {it.last_known_institution_name || "—"}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {it.works_count.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums">
                    {it.cited_by_count.toLocaleString()}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums pr-4">
                    {it.h_index ?? "—"}
                  </td>
                </tr>
              ))}
              {!loading && items.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No authors found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* footer */}
        <div className="flex items-center gap-3 p-3 border-t border-line text-xs text-slate-400">
          <span>
            {loading
              ? "Loading…"
              : "Click an author to load them in the graph."}
          </span>
          {!searching && (
            <div className="ml-auto flex items-center gap-2">
              <button
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE))}
                className="rounded-md border border-line px-2 py-1 hover:bg-line/60 disabled:opacity-30"
              >
                ‹ Prev
              </button>
              <span className="tabular-nums">
                {page} / {pages}
              </span>
              <button
                disabled={page >= pages}
                onClick={() => setOffset(offset + PAGE)}
                className="rounded-md border border-line px-2 py-1 hover:bg-line/60 disabled:opacity-30"
              >
                Next ›
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
