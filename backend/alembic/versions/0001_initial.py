"""initial UM author schema

Revision ID: 0001
Revises:
Create Date: 2026-06-01
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "0001"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")

    op.create_table(
        "authors",
        sa.Column("id", sa.String(), primary_key=True),
        sa.Column("display_name", sa.String(), nullable=False, server_default=""),
        sa.Column("orcid", sa.String(), nullable=True),
        sa.Column("works_count", sa.Integer(), server_default="0"),
        sa.Column("cited_by_count", sa.BigInteger(), server_default="0"),
        sa.Column("h_index", sa.Integer(), nullable=True),
        sa.Column("i10_index", sa.Integer(), nullable=True),
        sa.Column("two_year_mean_citedness", sa.Float(), nullable=True),
        sa.Column("last_known_institution_id", sa.String(), nullable=True),
        sa.Column("last_known_institution_name", sa.String(), nullable=True),
        sa.Column("country_code", sa.String(), nullable=True),
        sa.Column("is_current_um", sa.Boolean(), server_default=sa.text("true")),
        sa.Column("raw", postgresql.JSONB(), nullable=False),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )
    op.create_index(
        "ix_authors_display_name_trgm",
        "authors",
        ["display_name"],
        postgresql_using="gin",
        postgresql_ops={"display_name": "gin_trgm_ops"},
    )
    op.create_index("ix_authors_works_count", "authors", ["works_count"])
    op.create_index("ix_authors_cited_by_count", "authors", ["cited_by_count"])

    op.create_table(
        "author_concepts",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "author_id",
            sa.String(),
            sa.ForeignKey("authors.id", ondelete="CASCADE"),
            index=True,
        ),
        sa.Column("concept_id", sa.String(), nullable=True),
        sa.Column("display_name", sa.String(), nullable=True),
        sa.Column("level", sa.Integer(), nullable=True),
        sa.Column("score", sa.Float(), nullable=True),
    )
    op.create_index("ix_author_concepts_concept_id", "author_concepts", ["concept_id"])

    op.create_table(
        "author_affiliations",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "author_id",
            sa.String(),
            sa.ForeignKey("authors.id", ondelete="CASCADE"),
            index=True,
        ),
        sa.Column("institution_id", sa.String(), nullable=True),
        sa.Column("name", sa.String(), nullable=True),
        sa.Column("country_code", sa.String(), nullable=True),
        sa.Column("type", sa.String(), nullable=True),
        sa.Column("years", postgresql.JSONB(), nullable=True),
    )

    op.create_table(
        "collaborators",
        sa.Column("author_id", sa.String(), primary_key=True),
        sa.Column("collaborator_id", sa.String(), primary_key=True),
        sa.Column("work_count", sa.Integer(), server_default="0"),
        sa.Column("shared_work_ids", postgresql.JSONB(), nullable=True),
        sa.Column(
            "fetched_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
        ),
    )


def downgrade() -> None:
    op.drop_table("collaborators")
    op.drop_table("author_affiliations")
    op.drop_table("author_concepts")
    op.drop_index("ix_authors_cited_by_count", table_name="authors")
    op.drop_index("ix_authors_works_count", table_name="authors")
    op.drop_index("ix_authors_display_name_trgm", table_name="authors")
    op.drop_table("authors")
