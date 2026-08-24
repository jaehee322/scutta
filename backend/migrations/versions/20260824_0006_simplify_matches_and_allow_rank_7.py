"""Remove unused match audit data and allow rank 7.

Revision ID: 20260824_0006
Revises: 20260824_0005
Create Date: 2026-08-24
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260824_0006"
down_revision: str | Sequence[str] | None = "20260824_0005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("matches") as batch_op:
        batch_op.drop_constraint(
            op.f("fk_matches_submitted_by_id_users"),
            type_="foreignkey",
        )
        batch_op.drop_constraint(
            op.f("fk_matches_updated_by_id_users"),
            type_="foreignkey",
        )
        batch_op.drop_column("submitted_by_id")
        batch_op.drop_column("updated_by_id")
        batch_op.drop_column("updated_at")
        # `created_at` was the historical submission timestamp. Preserve every
        # existing value while giving the column its domain-specific name.
        batch_op.alter_column(
            "created_at",
            new_column_name="played_at",
            existing_type=sa.DateTime(timezone=True),
            existing_nullable=False,
            existing_server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=True,
            server_default=None,
        )

    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_constraint(op.f("ck_users_club_rank_range"), type_="check")
        batch_op.create_check_constraint(
            op.f("ck_users_club_rank_range"),
            "club_rank IS NULL OR club_rank BETWEEN -2 AND 7",
        )


def downgrade() -> None:
    op.execute("UPDATE users SET club_rank = 6 WHERE club_rank > 6")
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_constraint(op.f("ck_users_club_rank_range"), type_="check")
        batch_op.create_check_constraint(
            op.f("ck_users_club_rank_range"),
            "club_rank IS NULL OR club_rank BETWEEN -2 AND 6",
        )

    # A database that ran the earlier untracked 0006 may have received a
    # nullable compatibility column in 0007. created_at was non-null in the
    # historical schema, so make those irrecoverable values structurally valid.
    op.execute("UPDATE matches SET played_at = CURRENT_TIMESTAMP WHERE played_at IS NULL")

    with op.batch_alter_table("matches") as batch_op:
        batch_op.add_column(sa.Column("submitted_by_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("updated_by_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("updated_at", sa.DateTime(timezone=True), nullable=True))
        batch_op.alter_column(
            "played_at",
            new_column_name="created_at",
            existing_type=sa.DateTime(timezone=True),
            existing_nullable=True,
            existing_server_default=None,
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        )

    # The historical creation timestamp survived as played_at. Only the removed
    # actor/update audit values need structurally valid rollback fallbacks.
    op.execute(
        "UPDATE matches SET submitted_by_id = player1_id, "
        "updated_at = CURRENT_TIMESTAMP"
    )

    with op.batch_alter_table("matches") as batch_op:
        batch_op.alter_column(
            "submitted_by_id",
            existing_type=sa.Integer(),
            nullable=False,
        )
        batch_op.alter_column(
            "updated_at",
            existing_type=sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("CURRENT_TIMESTAMP"),
        )
        batch_op.create_foreign_key(
            op.f("fk_matches_submitted_by_id_users"),
            "users",
            ["submitted_by_id"],
            ["id"],
            ondelete="RESTRICT",
        )
        batch_op.create_foreign_key(
            op.f("fk_matches_updated_by_id_users"),
            "users",
            ["updated_by_id"],
            ["id"],
            ondelete="SET NULL",
        )
