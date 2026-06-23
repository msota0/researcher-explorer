import type {
  AuthorDetail,
  BrowseResponse,
  BrowseSort,
  GraphPayload,
  SearchHit,
} from "../types";

const base = ""; // vite proxy forwards /api/* to backend

async function jget<T>(path: string): Promise<T> {
  const r = await fetch(base + path);
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

export const api = {
  searchAuthors: (q: string, limit = 8) =>
    jget<SearchHit[]>(`/api/authors/search?q=${encodeURIComponent(q)}&limit=${limit}`),

  getAuthor: (id: string) => jget<AuthorDetail>(`/api/authors/${id}`),

  browse: (limit = 50, offset = 0, sort: BrowseSort = "works_count") =>
    jget<BrowseResponse>(
      `/api/authors/browse?limit=${limit}&offset=${offset}&sort=${sort}`,
    ),

  expand: (id: string, depth = 1, maxPerNode = 40) =>
    jget<GraphPayload>(
      `/api/graph/expand?author_id=${id}&depth=${depth}&max_per_node=${maxPerNode}`,
    ),
};
