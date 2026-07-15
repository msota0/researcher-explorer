import { useEffect, useState } from "react";
import type { Core } from "cytoscape";
import { api } from "../lib/api";
import { GraphStore } from "../lib/graphStore";
import { egoNetwork, exportEgoJson, exportEgoPng } from "../lib/extract";
import type { AuthorDetail } from "../types";

interface Props {
  authorId: string | null;
  cy: Core | null;
  store: GraphStore;
  onClose: () => void;
  open: boolean;
  onToggle: () => void;
}

export function SidePanel({
  authorId,
  cy,
  store,
  onClose,
  open,
  onToggle,
}: Props) {
  const [detail, setDetail] = useState<AuthorDetail | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!authorId) return;
    setLoading(true);
    setDetail(null);
    api
      .getAuthor(authorId)
      .then(setDetail)
      .finally(() => setLoading(false));
  }, [authorId]);

  if (!authorId) return null;

  // Collapsed: leave a small tab on the right edge to reveal the panel again.
  if (!open) {
    return (
      <button
        onClick={onToggle}
        title="Show author panel"
        className="absolute right-3 top-16 z-10 flex items-center gap-2 bg-panel/90 backdrop-blur border border-line rounded-lg px-3 py-2 text-xs font-medium text-slate-200 hover:bg-line/50"
      >
        Author <span className="text-accent">‹</span>
      </button>
    );
  }

  return (
    <aside className="absolute right-0 top-16 bottom-0 w-[380px] bg-panel/95 backdrop-blur border-l border-t border-line rounded-tl-lg p-4 overflow-y-auto z-10">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm uppercase tracking-wide text-slate-400">Author</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={onToggle}
            title="Collapse author panel"
            className="flex items-center gap-1 rounded-md bg-panel2 border border-line hover:bg-line/60 text-[11px] text-slate-300 px-2 py-1 leading-none"
          >
            Hide <span className="text-accent">›</span>
          </button>
          <button
            onClick={onClose}
            className="rounded-md bg-panel2 border border-line hover:bg-line/60 text-[11px] text-slate-300 px-2 py-1 leading-none"
          >
            close
          </button>
        </div>
      </div>

      {loading && <div className="text-sm text-slate-400">Loading…</div>}

      {detail && (
        <>
          <h1 className="text-xl font-semibold leading-tight">
            {detail.display_name}
          </h1>
          {detail.last_known_institution?.display_name && (
            <div className="text-sm text-slate-400 mt-1">
              {detail.last_known_institution.display_name}
              {detail.last_known_institution.country_code
                ? ` · ${detail.last_known_institution.country_code}`
                : ""}
            </div>
          )}

          <div className="grid grid-cols-3 gap-2 mt-4">
            <Stat label="works" value={detail.works_count.toLocaleString()} />
            <Stat
              label="citations"
              value={detail.cited_by_count.toLocaleString()}
            />
            <Stat label="h-index" value={detail.h_index ?? "—"} />
          </div>

          <Section title="This author's network">
            {(() => {
              const count = egoNetwork(store, detail.id).nodes.length - 1;
              return (
                <>
                  <div className="text-xs text-slate-500 mb-2">
                    {count > 0
                      ? `${count} collaborator${count === 1 ? "" : "s"} currently in the graph — the same subset highlighted on hover.`
                      : "No collaborators loaded yet. Expand to build the network."}
                  </div>
                  <div className="flex gap-2">
                    <button
                      disabled={count === 0}
                      onClick={() => exportEgoJson(store, detail.id)}
                      className="flex-1 rounded-md bg-panel2 border border-line hover:border-accent/60 disabled:opacity-40 disabled:cursor-not-allowed text-xs py-1.5"
                      title="Download this sub-network as JSON (nodes + edges)"
                    >
                      Extract JSON
                    </button>
                    <button
                      disabled={count === 0 || !cy}
                      onClick={() => cy && exportEgoPng(cy, store, detail.id)}
                      className="flex-1 rounded-md bg-panel2 border border-line hover:border-accent/60 disabled:opacity-40 disabled:cursor-not-allowed text-xs py-1.5"
                      title="Download this sub-network as a PNG image"
                    >
                      Extract PNG
                    </button>
                  </div>
                </>
              );
            })()}
          </Section>

          <Section title="Affiliations">
            {detail.affiliations.length === 0 ? (
              <div className="text-xs text-slate-500">None on record.</div>
            ) : (
              <ul className="text-xs space-y-1">
                {detail.affiliations.slice(0, 8).map((a, i) => (
                  <li key={i}>
                    {a.display_name}{" "}
                    <span className="text-slate-500">
                      {a.country_code ? `· ${a.country_code}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="Top concepts">
            <div className="flex flex-wrap gap-1.5">
              {detail.concepts.slice(0, 10).map((c) => (
                <span
                  key={c.id}
                  className="text-xs px-2 py-0.5 rounded-full bg-line/60 border border-line text-slate-300"
                >
                  {c.display_name}
                </span>
              ))}
            </div>
          </Section>

          <Section title="Identifiers">
            <ul className="text-xs space-y-1 text-slate-300">
              <li>
                OpenAlex:{" "}
                <a
                  className="text-accent hover:underline"
                  target="_blank"
                  rel="noreferrer"
                  href={`https://openalex.org/${detail.id}`}
                >
                  {detail.id}
                </a>
              </li>
              {detail.orcid && (
                <li>
                  ORCID:{" "}
                  <a
                    className="text-accent hover:underline"
                    target="_blank"
                    rel="noreferrer"
                    href={detail.orcid}
                  >
                    {detail.orcid.replace("https://orcid.org/", "")}
                  </a>
                </li>
              )}
              {detail.homepage && (
                <li>
                  Homepage:{" "}
                  <a
                    className="text-accent hover:underline"
                    target="_blank"
                    rel="noreferrer"
                    href={detail.homepage}
                  >
                    link
                  </a>
                </li>
              )}
              {detail.wikipedia && (
                <li>
                  Wikipedia:{" "}
                  <a
                    className="text-accent hover:underline"
                    target="_blank"
                    rel="noreferrer"
                    href={detail.wikipedia}
                  >
                    page
                  </a>
                </li>
              )}
            </ul>
          </Section>

          {detail.counts_by_year?.length > 0 && (
            <Section title="Activity by year">
              <YearSpark data={detail.counts_by_year} />
            </Section>
          )}
        </>
      )}
    </aside>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md bg-panel2 border border-line p-2">
      <div className="text-[10px] uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-5">
      <h3 className="text-xs uppercase tracking-wider text-slate-500 mb-2">
        {title}
      </h3>
      {children}
    </div>
  );
}

function YearSpark({
  data,
}: {
  data: { year: number; works_count: number; cited_by_count: number }[];
}) {
  const sorted = [...data].sort((a, b) => a.year - b.year);
  const max = Math.max(...sorted.map((d) => d.works_count), 1);
  return (
    <div className="flex items-end gap-0.5 h-16">
      {sorted.map((d) => (
        <div
          key={d.year}
          title={`${d.year}: ${d.works_count} works`}
          className="flex-1 bg-accent/40 rounded-t-sm"
          style={{ height: `${(d.works_count / max) * 100}%` }}
        />
      ))}
    </div>
  );
}
