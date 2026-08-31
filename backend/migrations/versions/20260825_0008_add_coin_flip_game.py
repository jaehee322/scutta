"""Add persistent coin-flip mini-game state.

Revision ID: 20260825_0008
Revises: 20260825_0007
Create Date: 2026-08-25
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260825_0008"
down_revision: str | Sequence[str] | None = "20260825_0007"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "coin_flip_states",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("active", sa.Boolean(), nullable=False),
        sa.Column("run_id", sa.Integer(), nullable=False),
        sa.Column("current_streak", sa.Integer(), nullable=False),
        sa.Column("best_streak", sa.Integer(), nullable=False),
        sa.Column("best_achieved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_flip_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(
            "(best_streak = 0 AND best_achieved_at IS NULL) OR "
            "(best_streak > 0 AND best_achieved_at IS NOT NULL)",
            name=op.f("ck_coin_flip_states_best_achievement_time"),
        ),
        sa.CheckConstraint(
            "best_streak >= 0",
            name=op.f("ck_coin_flip_states_best_streak_nonnegative"),
        ),
        sa.CheckConstraint(
            "current_streak <= best_streak",
            name=op.f("ck_coin_flip_states_current_not_above_best"),
        ),
        sa.CheckConstraint(
            "current_streak >= 0",
            name=op.f("ck_coin_flip_states_current_streak_nonnegative"),
        ),
        sa.CheckConstraint(
            "run_id > 0",
            name=op.f("ck_coin_flip_states_run_id_positive"),
        ),
        sa.CheckConstraint(
            "active OR current_streak = 0",
            name=op.f("ck_coin_flip_states_inactive_streak_zero"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_coin_flip_states_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_coin_flip_states")),
    )


def downgrade() -> None:
    op.drop_table("coin_flip_states")
