"""Separate automatic completion from next-day or manual closure.

Revision ID: 20260911_0013
Revises: 20260909_0012
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260911_0013"
down_revision: str | Sequence[str] | None = "20260909_0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _ensure_sqlite_foreign_keys_off() -> None:
    connection = op.get_bind()
    if (
        connection.dialect.name == "sqlite"
        and connection.exec_driver_sql("PRAGMA foreign_keys").scalar()
    ):
        raise RuntimeError(
            "SQLite competition migration requires foreign_keys=OFF on the migration "
            "connection before recreating the parent table; no records were changed."
        )


def _replace_checks(*, include_closed: bool) -> None:
    _ensure_sqlite_foreign_keys_off()
    statuses = "'active', 'completed', 'closed'" if include_closed else "'active', 'completed'"
    finished = "status IN ('completed', 'closed')" if include_closed else "status = 'completed'"
    with op.batch_alter_table("competitions") as batch:
        for name in ("competition_status", "completion_state"):
            batch.drop_constraint(op.f(f"ck_competitions_{name}"), type_="check")
        batch.create_check_constraint(
            op.f("ck_competitions_competition_status"), f"status IN ({statuses})"
        )
        batch.create_check_constraint(
            op.f("ck_competitions_completion_state"),
            "(status = 'active' AND completed_at IS NULL) OR "
            f"({finished} AND completed_at IS NOT NULL)",
        )


def upgrade() -> None:
    _replace_checks(include_closed=True)
    # Before this revision, completed meant an administrator had closed the event.
    op.execute(sa.text("UPDATE competitions SET status = 'closed' WHERE status = 'completed'"))
    # Match no longer retains an immutable input timestamp. played_at/played_on
    # can be edited and must not be presented as the historical completion time.
    # Existing fully recorded active events therefore complete at migration time.
    op.execute(
        sa.text(
            """
            UPDATE competitions
            SET status = 'completed', completed_at = CURRENT_TIMESTAMP
            WHERE status = 'active' AND (
                (type = 'league'
                    AND EXISTS (
                        SELECT 1 FROM league_fixtures f
                        WHERE f.competition_id = competitions.id
                    )
                    AND NOT EXISTS (
                        SELECT 1 FROM league_fixtures f
                        WHERE f.competition_id = competitions.id AND f.match_id IS NULL
                    )
                ) OR (type = 'team'
                    AND EXISTS (
                        SELECT 1 FROM team_encounters e
                        WHERE e.competition_id = competitions.id
                    )
                    AND NOT EXISTS (
                        SELECT 1 FROM team_encounters e
                        WHERE e.competition_id = competitions.id AND (
                            (SELECT COUNT(*) FROM team_single_games s
                                WHERE s.encounter_id = e.id) <> 4
                            OR (
                                (SELECT COUNT(*) FROM team_single_games s
                                    JOIN matches m ON m.id = s.match_id
                                    WHERE s.encounter_id = e.id AND (
                                        (m.player1_id = s.team1_player_id AND m.score1 > m.score2)
                                        OR (m.player2_id = s.team1_player_id
                                            AND m.score2 > m.score1)
                                    )) = 2
                                AND NOT EXISTS (
                                    SELECT 1 FROM team_doubles_games d
                                    WHERE d.encounter_id = e.id
                                        AND d.score1 IS NOT NULL AND d.score2 IS NOT NULL
                                )
                            )
                        )
                    )
                )
            )
            """
        )
    )


def downgrade() -> None:
    # The old schema has one finished state. Preserve all timestamps/results;
    # it cannot retain the distinction between automatic and manual closure.
    _ensure_sqlite_foreign_keys_off()
    op.execute(sa.text("UPDATE competitions SET status = 'completed' WHERE status = 'closed'"))
    _replace_checks(include_closed=False)
