"""Remove the user activation flag.

Revision ID: 20260816_0002
Revises: 20260813_0001
Create Date: 2026-08-16
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260816_0002"
down_revision: str | Sequence[str] | None = "20260813_0001"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.drop_index("ix_users_is_active")
        batch_op.drop_column("is_active")


def downgrade() -> None:
    with op.batch_alter_table("users") as batch_op:
        batch_op.add_column(
            sa.Column(
                "is_active",
                sa.Boolean(),
                server_default=sa.true(),
                nullable=False,
            )
        )
        batch_op.create_index("ix_users_is_active", ["is_active"], unique=False)

    # The temporary default populates existing rows but was not part of the
    # original schema, so remove it after the column has been restored.
    with op.batch_alter_table("users") as batch_op:
        batch_op.alter_column("is_active", server_default=None)
