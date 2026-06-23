"""ORM models for the UM author dataset.

Typed columns for everything we browse / sort / filter on, plus the full
OpenAlex record kept in `raw` (JSONB) so the detail view never loses data.
"""
from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


class Author(Base):
    __tablename__ = "authors"

    id: Mapped[str] = mapped_column(String, primary_key=True)  # e.g. A5012345678
    display_name: Mapped[str] = mapped_column(String, nullable=False, default="")
    orcid: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    works_count: Mapped[int] = mapped_column(Integer, default=0)
    cited_by_count: Mapped[int] = mapped_column(BigInteger, default=0)
    h_index: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    i10_index: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    two_year_mean_citedness: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    last_known_institution_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    last_known_institution_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    country_code: Mapped[Optional[str]] = mapped_column(String, nullable=True)

    # Whether UM is this author's *current* (last known) institution.
    is_current_um: Mapped[bool] = mapped_column(default=True)

    raw: Mapped[dict] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    concepts: Mapped[list["AuthorConcept"]] = relationship(
        back_populates="author", cascade="all, delete-orphan"
    )
    affiliations: Mapped[list["AuthorAffiliation"]] = relationship(
        back_populates="author", cascade="all, delete-orphan"
    )

    __table_args__ = (
        # Trigram index for fast partial / autocomplete name search (pg_trgm).
        Index(
            "ix_authors_display_name_trgm",
            "display_name",
            postgresql_using="gin",
            postgresql_ops={"display_name": "gin_trgm_ops"},
        ),
        Index("ix_authors_works_count", "works_count"),
        Index("ix_authors_cited_by_count", "cited_by_count"),
    )


class AuthorConcept(Base):
    __tablename__ = "author_concepts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    author_id: Mapped[str] = mapped_column(
        ForeignKey("authors.id", ondelete="CASCADE"), index=True
    )
    concept_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    display_name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    level: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    author: Mapped["Author"] = relationship(back_populates="concepts")

    __table_args__ = (Index("ix_author_concepts_concept_id", "concept_id"),)


class AuthorAffiliation(Base):
    __tablename__ = "author_affiliations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    author_id: Mapped[str] = mapped_column(
        ForeignKey("authors.id", ondelete="CASCADE"), index=True
    )
    institution_id: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    name: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    country_code: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    type: Mapped[Optional[str]] = mapped_column(String, nullable=True)
    years: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)

    author: Mapped["Author"] = relationship(back_populates="affiliations")


class Collaborator(Base):
    """Cached UM<->UM collaboration edges, populated lazily on graph expand."""

    __tablename__ = "collaborators"

    author_id: Mapped[str] = mapped_column(String, primary_key=True)
    collaborator_id: Mapped[str] = mapped_column(String, primary_key=True)
    work_count: Mapped[int] = mapped_column(Integer, default=0)
    shared_work_ids: Mapped[Optional[list]] = mapped_column(JSONB, nullable=True)
    fetched_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
