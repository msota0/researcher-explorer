import type { EncodingOpts } from "../types";

const SIZE_LABEL: Record<EncodingOpts["sizeBy"], string> = {
  degree: "node size = # collaborators",
  works: "node size = # works",
  citations: "node size = # citations",
};
const COLOR_LABEL: Record<EncodingOpts["colorBy"], string> = {
  institution: "color = institution",
  country: "color = country",
  depth: "color = depth from root",
};
const BORDER_LABEL: Record<EncodingOpts["borderBy"], string> = {
  h_index: "border = h-index",
  citations: "border = citations",
  none: "",
};

export function Legend({ encoding }: { encoding: EncodingOpts }) {
  const parts = [
    SIZE_LABEL[encoding.sizeBy],
    COLOR_LABEL[encoding.colorBy],
    BORDER_LABEL[encoding.borderBy],
    "edge thickness = # co-authored works",
  ].filter(Boolean);
  return (
    <div className="absolute left-3 bottom-3 z-10 bg-panel/90 backdrop-blur border border-line rounded-lg px-3 py-2 text-[11px] text-slate-400 space-y-0.5">
      {parts.map((p, i) => (
        <div key={i}>· {p}</div>
      ))}
      <div className="text-slate-500 mt-1">double-click a node to expand</div>
    </div>
  );
}
