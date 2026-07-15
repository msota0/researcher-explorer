import type { EncodingOpts, FilterOpts } from "../types";

interface Props {
  encoding: EncodingOpts;
  setEncoding: (e: EncodingOpts) => void;
  filters: FilterOpts;
  setFilters: (f: FilterOpts) => void;
  open: boolean;
  onToggle: () => void;
}

export function FilterPanel({
  encoding,
  setEncoding,
  filters,
  setFilters,
  open,
  onToggle,
}: Props) {
  if (!open) {
    return (
      <button
        onClick={onToggle}
        title="Show filters panel"
        className="absolute left-3 top-16 z-10 flex items-center gap-2 bg-panel/90 backdrop-blur border border-line rounded-lg px-3 py-2 text-xs font-medium text-slate-200 hover:bg-line/50"
      >
        <span className="text-accent">›</span> Filters
      </button>
    );
  }

  return (
    <div className="absolute left-3 top-16 w-[260px] bg-panel/90 backdrop-blur border border-line rounded-lg p-3 z-10 text-sm">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wider text-slate-500">
          Filters
        </div>
        <button
          onClick={onToggle}
          title="Collapse filters panel"
          className="flex items-center gap-1 rounded-md bg-panel2 border border-line hover:bg-line/60 text-[11px] text-slate-300 px-2 py-1 leading-none"
        >
          Hide <span className="text-accent">‹</span>
        </button>
      </div>

      <div className="text-xs uppercase tracking-wider text-slate-500 mb-2">
        Encoding
      </div>
      <Row label="Node size">
        <Select
          value={encoding.sizeBy}
          onChange={(v) => setEncoding({ ...encoding, sizeBy: v as any })}
          options={[
            ["degree", "Collaborator count"],
            ["works", "Works count"],
            ["citations", "Citations"],
          ]}
        />
      </Row>
      <Row label="Node color">
        <Select
          value={encoding.colorBy}
          onChange={(v) => setEncoding({ ...encoding, colorBy: v as any })}
          options={[
            ["institution", "Institution"],
            ["country", "Country"],
            ["depth", "Depth from root"],
          ]}
        />
      </Row>
      <Row label="Node border">
        <Select
          value={encoding.borderBy}
          onChange={(v) => setEncoding({ ...encoding, borderBy: v as any })}
          options={[
            ["h_index", "h-index"],
            ["citations", "Citations"],
            ["none", "None"],
          ]}
        />
      </Row>

      <div className="text-xs uppercase tracking-wider text-slate-500 mt-4 mb-2">
        Filters
      </div>
      <Row label="Min works">
        <input
          type="number"
          min={0}
          value={filters.minWorks}
          onChange={(e) =>
            setFilters({ ...filters, minWorks: Number(e.target.value) || 0 })
          }
          className="w-20 bg-panel2 border border-line rounded px-2 py-1 text-xs"
        />
      </Row>
      <Row label="Institution contains">
        <input
          type="text"
          value={filters.institutionContains}
          onChange={(e) =>
            setFilters({ ...filters, institutionContains: e.target.value })
          }
          placeholder="e.g. MIT"
          className="w-32 bg-panel2 border border-line rounded px-2 py-1 text-xs"
        />
      </Row>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-slate-400">{label}</span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (v: string) => void;
  options: [string, string][];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-panel2 border border-line rounded px-2 py-1 text-xs"
    >
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );
}
