"""Add exact team-doubles submission timestamps.

Revision ID: 20260825_0007
Revises: 20260824_0006
Create Date: 2026-08-25

Match timestamps were preserved by renaming matches.created_at in the previous
revision. Existing doubles rows deliberately remain NULL because their exact
submission time is unavailable.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import context, op

revision: str = "20260825_0007"
down_revision: str | Sequence[str] | None = "20260824_0006"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Compatibility for databases that already ran the earlier, untracked 0006
    # revision which dropped matches.created_at instead of renaming it. Fresh
    # upgrades through the revised 0006 already have a non-null played_at.
    if not context.is_offline_mode():
        match_columns = {
            column["name"] for column in sa.inspect(op.get_bind()).get_columns("matches")
        }
        if "played_at" not in match_columns:
            op.add_column(
                "matches",
                sa.Column("played_at", sa.DateTime(timezone=True), nullable=True),
            )
    op.add_column(
        "team_doubles_games",
        sa.Column("played_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("team_doubles_games", "played_at")
