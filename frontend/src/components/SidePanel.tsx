import { useEffect, useState } from "react";
import { api } from "../lib/api";
import type { AuthorDetail } from "../types";

interface Props {
  authorId: string | null;
  onClose: () => void;
  onExpand: (id: string) => void;
  isExpanded: boolean;
  isExpanding: boolean;
}

export function SidePanel({
  authorId,
  onClose,
  onExpand,
  isExpanded,
  isExpanding,
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

  return (
    <aside className="absolute right-0 top-0 bottom-0 w-[380px] bg-panel/95 backdrop-blur border-l border-line p-4 overflow-y-auto z-10">
      <div className="flex items-start justify-between mb-3">
        <h2 className="text-sm uppercase tracking-wide text-slate-400">Author</h2>
        <button
          onClick={onClose}
          className="text-slate-400 hover:text-slate-200 text-sm"
        >
          close
        </button>
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

          <div className="mt-4 flex gap-2">
            <button
              disabled={isExpanded || isExpanding}
              onClick={() => onExpand(detail.id)}
              className="flex-1 rounded-md bg-accent/20 border border-accent/40 hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed text-sm py-1.5"
            >
              {isExpanding
                ? "Expanding…"
                : isExpanded
                  ? "Already expanded"
                  : "Expand collaborators"}
            </button>
          </div>

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
