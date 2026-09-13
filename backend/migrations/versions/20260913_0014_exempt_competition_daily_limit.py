"""Apply the daily opponent limit only to matches outside competitions.

Revision ID: 20260913_0014
Revises: 20260911_0013
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260913_0014"
down_revision: str | Sequence[str] | None = "20260911_0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

PAIR_COLUMNS = ["played_on", "player1_id", "player2_id"]


def _ensure_sqlite_foreign_keys_off() -> None:
    connection = op.get_bind()
    if (
        connection.dialect.name == "sqlite"
        and connection.exec_driver_sql("PRAGMA foreign_keys").scalar()
    ):
        raise RuntimeError(
            "SQLite daily pair migration requires foreign_keys=OFF on the migration "
            "connection before recreating matches; no records were changed."
        )


def upgrade() -> None:
    _ensure_sqlite_foreign_keys_off()
    with op.batch_alter_table("matches") as batch:
        batch.drop_constraint("daily_player_pair", type_="unique")
    op.create_index(
        "daily_player_pair",
        "matches",
        PAIR_COLUMNS,
        unique=True,
        sqlite_where=sa.text("competition_id IS NULL"),
        postgresql_where=sa.text("competition_id IS NULL"),
    )


def downgrade() -> None:
    if op.get_context().as_sql:
        raise RuntimeError("Daily pair downgrade requires online checks for duplicate matches.")
    _ensure_sqlite_foreign_keys_off()
    connection = op.get_bind()
    # Keep concurrent writers out between the preflight and restoring the old
    # uniqueness rule. SQLite's DBAPI may not have begun its logical transaction yet.
    if connection.dialect.name == "postgresql":
        connection.exec_driver_sql("LOCK TABLE matches IN ACCESS EXCLUSIVE MODE")
    elif (
        connection.dialect.name == "sqlite"
        and not connection.connection.driver_connection.in_transaction
    ):
        connection.exec_driver_sql("BEGIN IMMEDIATE")
    duplicate = connection.execute(
        sa.text(
            "SELECT 1 FROM matches GROUP BY played_on, player1_id, player2_id "
            "HAVING COUNT(*) > 1 LIMIT 1"
        )
    ).first()
    if duplicate is not None:
        raise RuntimeError(
            "Cannot restore the old daily opponent limit while duplicate same-day player "
            "pairs exist across competition or regular matches; no records were changed."
        )
    with op.batch_alter_table("matches") as batch:
        batch.drop_index("daily_player_pair")
        batch.create_unique_constraint("daily_player_pair", PAIR_COLUMNS)
