"""Add persistent settlement settings.

Revision ID: 20260824_0005
Revises: 20260818_0004
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824_0005"
down_revision: str | Sequence[str] | None = "20260818_0004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "settlement_settings",
        sa.Column("id", sa.SmallInteger(), nullable=False),
        sa.Column("matches_prize", sa.String(length=200), nullable=True),
        sa.Column("wins_prize", sa.String(length=200), nullable=True),
        sa.Column("losses_prize", sa.String(length=200), nullable=True),
        sa.Column("opponents_prize", sa.String(length=200), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.CheckConstraint("id = 1", name=op.f("ck_settlement_settings_singleton")),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_settlement_settings")),
    )
    # Null override fields deliberately preserve the environment settings as
    # defaults until an administrator changes them through the API.
    op.execute("INSERT INTO settlement_settings (id) VALUES (1)")


def downgrade() -> None:
    op.drop_table("settlement_settings")
