"""Add the daily coin-flip attempt limit state.

Revision ID: 20260902_0009
Revises: 20260825_0008
Create Date: 2026-09-02
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260902_0009"
down_revision: str | Sequence[str] | None = "20260825_0008"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("coin_flip_states") as batch_op:
        batch_op.add_column(sa.Column("daily_attempt_date", sa.Date(), nullable=True))
        batch_op.add_column(
            sa.Column(
                "daily_attempts_used",
                sa.SmallInteger(),
                server_default=sa.text("0"),
                nullable=False,
            )
        )
        batch_op.create_check_constraint(
            op.f("ck_coin_flip_states_daily_attempts_range"),
            "daily_attempts_used >= 0 AND daily_attempts_used <= 20",
        )
        batch_op.create_check_constraint(
            op.f("ck_coin_flip_states_daily_attempts_date_consistency"),
            "(daily_attempt_date IS NULL AND daily_attempts_used = 0) OR "
            "(daily_attempt_date IS NOT NULL AND daily_attempts_used > 0)",
        )


def downgrade() -> None:
    with op.batch_alter_table("coin_flip_states") as batch_op:
        batch_op.drop_constraint(
            op.f("ck_coin_flip_states_daily_attempts_date_consistency"), type_="check"
        )
        batch_op.drop_constraint(
            op.f("ck_coin_flip_states_daily_attempts_range"), type_="check"
        )
        batch_op.drop_column("daily_attempts_used")
        batch_op.drop_column("daily_attempt_date")
