from typing import Optional
from pydantic import BaseModel


class Institution(BaseModel):
    id: Optional[str] = None
    display_name: Optional[str] = None
    country_code: Optional[str] = None
    type: Optional[str] = None


class Concept(BaseModel):
    id: Optional[str] = None
    display_name: Optional[str] = None
    level: Optional[int] = None
    score: Optional[float] = None


class AuthorSummary(BaseModel):
    """Lightweight author payload for graph nodes."""
    id: str
    display_name: str
    orcid: Optional[str] = None
    works_count: int = 0
    cited_by_count: int = 0
    h_index: Optional[int] = None
    i10_index: Optional[int] = None
    last_known_institution: Optional[Institution] = None
    country_code: Optional[str] = None


class AuthorDetail(AuthorSummary):
    """Extended author payload for the side panel."""
    two_year_mean_citedness: Optional[float] = None
    affiliations: list[Institution] = []
    concepts: list[Concept] = []
    homepage: Optional[str] = None
    scopus: Optional[str] = None
    twitter: Optional[str] = None
    wikipedia: Optional[str] = None
    works_api_url: Optional[str] = None
    counts_by_year: list[dict] = []


class GraphNode(BaseModel):
    id: str
    data: AuthorSummary
    depth: int


class GraphEdge(BaseModel):
    source: str
    target: str
    weight: int  # # of co-authored works
    shared_work_ids: list[str] = []


class GraphPayload(BaseModel):
    root_id: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    truncated: bool = False
