export interface Institution {
  id?: string;
  display_name?: string;
  country_code?: string;
  type?: string;
}

export interface Concept {
  id?: string;
  display_name?: string;
  level?: number;
  score?: number;
}

export interface AuthorSummary {
  id: string;
  display_name: string;
  orcid?: string | null;
  works_count: number;
  cited_by_count: number;
  h_index?: number | null;
  i10_index?: number | null;
  last_known_institution?: Institution | null;
  country_code?: string | null;
}

export interface AuthorDetail extends AuthorSummary {
  two_year_mean_citedness?: number | null;
  affiliations: Institution[];
  concepts: Concept[];
  homepage?: string | null;
  scopus?: string | null;
  twitter?: string | null;
  wikipedia?: string | null;
  works_api_url?: string | null;
  counts_by_year: { year: number; works_count: number; cited_by_count: number }[];
}

export interface GraphNode {
  id: string;
  data: AuthorSummary;
  depth: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  weight: number;
  shared_work_ids: string[];
}

export interface GraphPayload {
  root_id: string;
  nodes: GraphNode[];
  edges: GraphEdge[];
  truncated: boolean;
}

export interface SearchHit {
  id: string;
  display_name: string;
  works_count: number;
  cited_by_count: number;
  last_known_institution?: Institution | null;
  orcid?: string | null;
}

export interface BrowseItem {
  id: string;
  display_name: string;
  works_count: number;
  cited_by_count: number;
  h_index?: number | null;
  last_known_institution_name?: string | null;
}

export interface BrowseResponse {
  total: number;
  limit: number;
  offset: number;
  items: BrowseItem[];
}

export type BrowseSort = "works_count" | "cited_by_count" | "h_index" | "display_name";

export type ColorBy = "institution" | "country" | "depth";
export type SizeBy = "degree" | "works" | "citations";
export type BorderBy = "h_index" | "citations" | "none";

export interface EncodingOpts {
  sizeBy: SizeBy;
  colorBy: ColorBy;
  borderBy: BorderBy;
}

export interface FilterOpts {
  minWorks: number;
  yearMin: number | null;
  yearMax: number | null;
  institutionContains: string;
}
