"""Pure functions mapping an OpenAlex author payload to DB rows / API models.

Centralised so the importer and the API build authors the same way.
"""
from __future__ import annotations

from typing import Optional

from .models import AuthorDetail, AuthorSummary, Concept, Institution


def short_id(openalex_id: Optional[str]) -> Optional[str]:
    if not openalex_id:
        return openalex_id
    return openalex_id.rsplit("/", 1)[-1]


def _institution_payload(payload: dict) -> Optional[dict]:
    inst = payload.get("last_known_institution")
    if not inst:
        insts = payload.get("last_known_institutions") or []
        if insts:
            inst = insts[0]
    if not inst:
        affs = payload.get("affiliations") or []
        if affs:
            inst = (affs[0] or {}).get("institution")
    return inst or None


def _stats(payload: dict) -> dict:
    return payload.get("summary_stats") or {}


def author_columns(payload: dict, *, um_institution_id: str) -> dict:
    """Flatten an OpenAlex payload into Author table column values."""
    sid = short_id(payload["id"])
    stats = _stats(payload)
    inst = _institution_payload(payload)
    inst_id = short_id(inst.get("id")) if inst else None
    return {
        "id": sid,
        "display_name": payload.get("display_name") or sid,
        "orcid": payload.get("orcid"),
        "works_count": payload.get("works_count", 0) or 0,
        "cited_by_count": payload.get("cited_by_count", 0) or 0,
        "h_index": stats.get("h_index"),
        "i10_index": stats.get("i10_index"),
        "two_year_mean_citedness": stats.get("2yr_mean_citedness"),
        "last_known_institution_id": inst_id,
        "last_known_institution_name": inst.get("display_name") if inst else None,
        "country_code": inst.get("country_code") if inst else None,
        "is_current_um": inst_id == um_institution_id,
        "raw": payload,
    }


def concept_rows(payload: dict) -> list[dict]:
    out = []
    for c in (payload.get("x_concepts") or [])[:25]:
        out.append(
            {
                "concept_id": short_id(c.get("id")),
                "display_name": c.get("display_name"),
                "level": c.get("level"),
                "score": c.get("score"),
            }
        )
    return out


def affiliation_rows(payload: dict) -> list[dict]:
    out = []
    for a in payload.get("affiliations") or []:
        i = a.get("institution") or {}
        out.append(
            {
                "institution_id": short_id(i.get("id")),
                "name": i.get("display_name"),
                "country_code": i.get("country_code"),
                "type": i.get("type"),
                "years": a.get("years") or [],
            }
        )
    return out


# ---------- payload -> API models ----------

def to_summary(payload: dict) -> AuthorSummary:
    sid = short_id(payload["id"])
    inst = _institution_payload(payload)
    stats = _stats(payload)
    institution = (
        Institution(
            id=short_id(inst.get("id")),
            display_name=inst.get("display_name"),
            country_code=inst.get("country_code"),
            type=inst.get("type"),
        )
        if inst
        else None
    )
    return AuthorSummary(
        id=sid,
        display_name=payload.get("display_name") or sid,
        orcid=payload.get("orcid"),
        works_count=payload.get("works_count", 0) or 0,
        cited_by_count=payload.get("cited_by_count", 0) or 0,
        h_index=stats.get("h_index"),
        i10_index=stats.get("i10_index"),
        last_known_institution=institution,
        country_code=institution.country_code if institution else None,
    )


def to_detail(payload: dict) -> AuthorDetail:
    sid = short_id(payload["id"])
    stats = _stats(payload)
    inst = _institution_payload(payload)
    institution = (
        Institution(
            id=short_id(inst.get("id")),
            display_name=inst.get("display_name"),
            country_code=inst.get("country_code"),
            type=inst.get("type"),
        )
        if inst
        else None
    )
    affiliations = []
    for a in payload.get("affiliations") or []:
        i = a.get("institution") or {}
        affiliations.append(
            Institution(
                id=short_id(i.get("id")),
                display_name=i.get("display_name"),
                country_code=i.get("country_code"),
                type=i.get("type"),
            )
        )
    concepts = [
        Concept(
            id=short_id(c.get("id")),
            display_name=c.get("display_name"),
            level=c.get("level"),
            score=c.get("score"),
        )
        for c in (payload.get("x_concepts") or [])[:15]
    ]
    ids = payload.get("ids") or {}
    return AuthorDetail(
        id=sid,
        display_name=payload.get("display_name") or sid,
        orcid=payload.get("orcid"),
        works_count=payload.get("works_count", 0) or 0,
        cited_by_count=payload.get("cited_by_count", 0) or 0,
        h_index=stats.get("h_index"),
        i10_index=stats.get("i10_index"),
        two_year_mean_citedness=stats.get("2yr_mean_citedness"),
        last_known_institution=institution,
        country_code=institution.country_code if institution else None,
        affiliations=affiliations,
        concepts=concepts,
        homepage=ids.get("homepage"),
        scopus=ids.get("scopus"),
        twitter=ids.get("twitter"),
        wikipedia=ids.get("wikipedia"),
        works_api_url=payload.get("works_api_url"),
        counts_by_year=payload.get("counts_by_year") or [],
    )
