"""Add persistent paddle-flight high scores.

Revision ID: 20260904_0010
Revises: 20260902_0009
Create Date: 2026-09-04
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260904_0010"
down_revision: str | Sequence[str] | None = "20260902_0009"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "paddle_flight_scores",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("best_score", sa.Integer(), nullable=False),
        sa.Column("best_achieved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_submitted_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "best_score >= 0 AND best_score <= 1000000",
            name=op.f("ck_paddle_flight_scores_best_score_range"),
        ),
        sa.CheckConstraint(
            "(best_score = 0 AND best_achieved_at IS NULL) OR "
            "(best_score > 0 AND best_achieved_at IS NOT NULL)",
            name=op.f("ck_paddle_flight_scores_best_achievement_time"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_paddle_flight_scores_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_paddle_flight_scores")),
    )


def downgrade() -> None:
    op.drop_table("paddle_flight_scores")
