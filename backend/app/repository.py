"""Read/query layer over the Postgres UM author dataset."""
from __future__ import annotations

from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from .db_models import Author, Collaborator


def search_authors(db: Session, query: str, limit: int = 10) -> list[dict]:
    """Partial name search across the UM dataset, ranked by output."""
    like = f"%{query}%"
    stmt = (
        select(Author)
        .where(Author.display_name.ilike(like))
        .order_by(Author.works_count.desc())
        .limit(limit)
    )
    rows = db.scalars(stmt).all()
    return [
        {
            "id": a.id,
            "display_name": a.display_name,
            "works_count": a.works_count,
            "cited_by_count": a.cited_by_count,
            "h_index": a.h_index,
            "orcid": a.orcid,
            "last_known_institution": (
                {
                    "id": a.last_known_institution_id,
                    "display_name": a.last_known_institution_name,
                }
                if a.last_known_institution_id
                else None
            ),
        }
        for a in rows
    ]


def list_authors(
    db: Session,
    *,
    limit: int = 50,
    offset: int = 0,
    sort: str = "works_count",
) -> dict:
    """Paginated browse of the whole UM dataset."""
    sort_col = {
        "works_count": Author.works_count,
        "cited_by_count": Author.cited_by_count,
        "h_index": Author.h_index,
        "display_name": Author.display_name,
    }.get(sort, Author.works_count)
    order = sort_col.asc() if sort == "display_name" else sort_col.desc()

    total = db.scalar(select(func.count()).select_from(Author)) or 0
    rows = db.scalars(
        select(Author).order_by(order).limit(limit).offset(offset)
    ).all()
    return {
        "total": total,
        "limit": limit,
        "offset": offset,
        "items": [
            {
                "id": a.id,
                "display_name": a.display_name,
                "works_count": a.works_count,
                "cited_by_count": a.cited_by_count,
                "h_index": a.h_index,
                "last_known_institution_name": a.last_known_institution_name,
            }
            for a in rows
        ],
    }


def get_author_raw(db: Session, author_id: str) -> Optional[dict]:
    row = db.get(Author, author_id)
    return row.raw if row else None


def get_authors_raw(db: Session, author_ids: list[str]) -> dict[str, dict]:
    if not author_ids:
        return {}
    rows = db.scalars(select(Author).where(Author.id.in_(author_ids))).all()
    return {a.id: a.raw for a in rows}


def um_ids_among(db: Session, candidate_ids: list[str]) -> set[str]:
    """Subset of candidate ids that are UM authors in our dataset."""
    if not candidate_ids:
        return set()
    rows = db.scalars(
        select(Author.id).where(Author.id.in_(candidate_ids))
    ).all()
    return set(rows)


def author_exists(db: Session, author_id: str) -> bool:
    return db.get(Author, author_id) is not None


# ---------- collaborator edge cache ----------

def get_cached_collaborators(db: Session, author_id: str) -> Optional[list[dict]]:
    rows = db.scalars(
        select(Collaborator).where(Collaborator.author_id == author_id)
    ).all()
    if not rows:
        return None
    return [
        {
            "id": r.collaborator_id,
            "work_count": r.work_count,
            "work_ids": r.shared_work_ids or [],
        }
        for r in rows
    ]


def put_collaborators(db: Session, author_id: str, collaborators: list[dict]) -> None:
    db.query(Collaborator).filter(Collaborator.author_id == author_id).delete()
    if collaborators:
        db.execute(
            pg_insert(Collaborator).values(
                [
                    {
                        "author_id": author_id,
                        "collaborator_id": c["id"],
                        "work_count": c["work_count"],
                        "shared_work_ids": c.get("work_ids") or [],
                    }
                    for c in collaborators
                ]
            )
        )
    db.commit()
