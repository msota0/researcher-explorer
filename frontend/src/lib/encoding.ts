import type { AuthorSummary, EncodingOpts } from "../types";

// Stable color palette for categorical encoding.
const PALETTE = [
  "#7dd3fc", "#fda4af", "#86efac", "#fcd34d", "#c4b5fd",
  "#f9a8d4", "#fdba74", "#a5f3fc", "#bef264", "#fca5a5",
  "#93c5fd", "#f0abfc", "#fde68a", "#6ee7b7", "#d8b4fe",
];

const DEPTH_COLORS = ["#fafafa", "#7dd3fc", "#c4b5fd", "#fda4af"];

const colorCache = new Map<string, string>();

export function colorForKey(key: string | null | undefined): string {
  if (!key) return "#64748b";
  if (colorCache.has(key)) return colorCache.get(key)!;
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) | 0;
  const c = PALETTE[Math.abs(h) % PALETTE.length];
  colorCache.set(key, c);
  return c;
}

export function nodeColor(
  a: AuthorSummary,
  depth: number,
  colorBy: EncodingOpts["colorBy"],
): string {
  if (colorBy === "depth") return DEPTH_COLORS[Math.min(depth, DEPTH_COLORS.length - 1)];
  if (colorBy === "country") return colorForKey(a.country_code);
  return colorForKey(a.last_known_institution?.id || a.last_known_institution?.display_name);
}

export function nodeSize(
  a: AuthorSummary,
  degree: number,
  sizeBy: EncodingOpts["sizeBy"],
): number {
  let raw = 1;
  if (sizeBy === "degree") raw = degree;
  else if (sizeBy === "works") raw = a.works_count || 1;
  else if (sizeBy === "citations") raw = a.cited_by_count || 1;
  // Log-scale so prolific authors don't blow out the layout.
  const v = Math.log10(Math.max(raw, 1) + 1);
  return Math.max(14, Math.min(70, 14 + v * 14));
}

export function borderWidth(
  a: AuthorSummary,
  borderBy: EncodingOpts["borderBy"],
): number {
  if (borderBy === "none") return 1;
  const v = borderBy === "h_index" ? a.h_index || 0 : a.cited_by_count || 0;
  const scaled = Math.log10(Math.max(v, 1) + 1);
  return Math.max(1, Math.min(8, scaled * (borderBy === "h_index" ? 1.6 : 1.2)));
}

export function edgeWidth(weight: number): number {
  // Weight = # co-authored works.
  const v = Math.log10(Math.max(weight, 1) + 1);
  return Math.max(1, Math.min(10, 1 + v * 3));
}
