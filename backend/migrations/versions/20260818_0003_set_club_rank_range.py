"""Allow SCUTTA club ranks from -2 through 6.

Revision ID: 20260818_0003
Revises: 20260816_0002
Create Date: 2026-08-18
"""

from collections.abc import Sequence

from alembic import op

revision: str = "20260818_0003"
down_revision: str | Sequence[str] | None = "20260816_0002"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # The previous schema allowed any positive value. Preserve deployability for
    # existing databases by moving legacy outliers to the new maximum.
    op.execute("UPDATE users SET club_rank = 6 WHERE club_rank > 6")
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_constraint(op.f("ck_users_club_rank_positive"), type_="check")
        batch_op.create_check_constraint(
            op.f("ck_users_club_rank_range"),
            "club_rank IS NULL OR club_rank BETWEEN -2 AND 6",
        )


def downgrade() -> None:
    # Values newly allowed by this revision cannot satisfy the former schema.
    # Map them to the nearest former valid rank before restoring its constraint.
    op.execute("UPDATE users SET club_rank = 1 WHERE club_rank BETWEEN -2 AND 0")
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_constraint(op.f("ck_users_club_rank_range"), type_="check")
        batch_op.create_check_constraint(
            op.f("ck_users_club_rank_positive"),
            "club_rank IS NULL OR club_rank > 0",
        )
