import type { EncodingOpts, FilterOpts } from "../types";

interface Props {
  encoding: EncodingOpts;
  setEncoding: (e: EncodingOpts) => void;
  filters: FilterOpts;
  setFilters: (f: FilterOpts) => void;
}

export function FilterPanel({ encoding, setEncoding, filters, setFilters }: Props) {
  return (
    <div className="absolute left-3 top-16 w-[260px] bg-panel/90 backdrop-blur border border-line rounded-lg p-3 z-10 text-sm">
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
