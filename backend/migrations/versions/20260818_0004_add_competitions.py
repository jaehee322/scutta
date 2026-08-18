"""Add individual league and team competition records.

Revision ID: 20260818_0004
Revises: 20260818_0003
Create Date: 2026-08-18
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260818_0004"
down_revision: str | Sequence[str] | None = "20260818_0003"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _ensure_legacy_competitions_are_empty() -> None:
    context = op.get_context()
    message = (
        "Competition scaffolding contains legacy rows. Reset the unused competition "
        "data before applying revision 20260818_0004."
    )
    if context.as_sql:
        # Render deploys run migrations online, where the Python check below
        # provides the same guard on every database. Keep PostgreSQL's optional
        # offline SQL output safe as well instead of silently omitting it.
        if context.dialect.name == "postgresql":
            op.execute(
                "DO $migration$ BEGIN "
                "IF EXISTS (SELECT 1 FROM competitions) THEN "
                f"RAISE EXCEPTION '{message}'; "
                "END IF; END $migration$"
            )
        return

    legacy_competitions = op.get_bind().scalar(sa.text("SELECT COUNT(*) FROM competitions"))
    if legacy_competitions:
        raise RuntimeError(message)


def upgrade() -> None:
    _ensure_legacy_competitions_are_empty()
    with op.batch_alter_table("competitions") as batch_op:
        batch_op.drop_constraint(op.f("ck_competitions_competition_type"), type_="check")
        batch_op.alter_column(
            "type",
            existing_type=sa.String(length=10),
            type_=sa.Enum(
                "league",
                "team",
                name="competition_type",
                native_enum=False,
                create_constraint=False,
            ),
            existing_nullable=False,
        )
        batch_op.create_check_constraint(
            op.f("ck_competitions_competition_type"), "type IN ('league', 'team')"
        )
        batch_op.add_column(sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(
        "UPDATE competitions SET completed_at = CURRENT_TIMESTAMP WHERE status = 'completed'"
    )
    with op.batch_alter_table("competitions") as batch_op:
        batch_op.create_check_constraint(
            op.f("ck_competitions_completion_state"),
            "(status = 'active' AND completed_at IS NULL) OR "
            "(status = 'completed' AND completed_at IS NOT NULL)",
        )

    with op.batch_alter_table("competition_members") as batch_op:
        batch_op.drop_constraint(op.f("ck_competition_members_position_positive"), type_="check")
        batch_op.drop_column("position")

    # Repair records that could have been made inconsistent by the former
    # generic admin kind editor before adding the database invariant.
    op.execute("UPDATE matches SET kind = 'competition' WHERE competition_id IS NOT NULL")
    op.execute(
        "UPDATE matches SET kind = 'casual' WHERE competition_id IS NULL AND kind = 'competition'"
    )
    with op.batch_alter_table("matches") as batch_op:
        batch_op.create_check_constraint(
            op.f("ck_matches_competition_link"),
            "(kind = 'competition' AND competition_id IS NOT NULL) OR "
            "(kind IN ('casual', 'daily') AND competition_id IS NULL)",
        )

    op.create_table(
        "competition_teams",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("competition_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.ForeignKeyConstraint(
            ["competition_id"],
            ["competitions.id"],
            name=op.f("fk_competition_teams_competition_id_competitions"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_competition_teams")),
        sa.UniqueConstraint("competition_id", "name", name="competition_team_name"),
        sa.UniqueConstraint("id", "competition_id", name="competition_team_identity"),
    )
    op.create_index(
        op.f("ix_competition_teams_competition_id"),
        "competition_teams",
        ["competition_id"],
        unique=False,
    )

    op.create_table(
        "league_fixtures",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("competition_id", sa.Integer(), nullable=False),
        sa.Column("player1_id", sa.Integer(), nullable=False),
        sa.Column("player2_id", sa.Integer(), nullable=False),
        sa.Column("round_no", sa.SmallInteger(), nullable=False),
        sa.Column("order_no", sa.SmallInteger(), nullable=False),
        sa.Column("match_id", sa.Integer(), nullable=True),
        sa.CheckConstraint(
            "player1_id < player2_id", name=op.f("ck_league_fixtures_canonical_player_order")
        ),
        sa.CheckConstraint("round_no > 0", name=op.f("ck_league_fixtures_round_positive")),
        sa.CheckConstraint("order_no > 0", name=op.f("ck_league_fixtures_order_positive")),
        sa.ForeignKeyConstraint(
            ["competition_id"],
            ["competitions.id"],
            name=op.f("fk_league_fixtures_competition_id_competitions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["match_id"],
            ["matches.id"],
            name=op.f("fk_league_fixtures_match_id_matches"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["player1_id"],
            ["users.id"],
            name=op.f("fk_league_fixtures_player1_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["player2_id"],
            ["users.id"],
            name=op.f("fk_league_fixtures_player2_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_league_fixtures")),
        sa.UniqueConstraint(
            "competition_id",
            "player1_id",
            "player2_id",
            name="league_fixture_player_pair",
        ),
        sa.UniqueConstraint(
            "competition_id", "round_no", "order_no", name="league_fixture_round_order"
        ),
        sa.UniqueConstraint("match_id", name=op.f("uq_league_fixtures_match_id")),
    )
    op.create_index(
        op.f("ix_league_fixtures_competition_id"),
        "league_fixtures",
        ["competition_id"],
        unique=False,
    )

    op.create_table(
        "competition_team_members",
        sa.Column("competition_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("team_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(
            ["team_id", "competition_id"],
            ["competition_teams.id", "competition_teams.competition_id"],
            name="team_member_team_identity",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_competition_team_members_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "competition_id", "user_id", name=op.f("pk_competition_team_members")
        ),
    )
    op.create_index(
        op.f("ix_competition_team_members_team_id"),
        "competition_team_members",
        ["team_id"],
        unique=False,
    )

    op.create_table(
        "team_encounters",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("competition_id", sa.Integer(), nullable=False),
        sa.Column("team1_id", sa.Integer(), nullable=False),
        sa.Column("team2_id", sa.Integer(), nullable=False),
        sa.Column("round_no", sa.SmallInteger(), nullable=False),
        sa.Column("order_no", sa.SmallInteger(), nullable=False),
        sa.CheckConstraint(
            "team1_id < team2_id", name=op.f("ck_team_encounters_canonical_team_order")
        ),
        sa.CheckConstraint("round_no > 0", name=op.f("ck_team_encounters_round_positive")),
        sa.CheckConstraint("order_no > 0", name=op.f("ck_team_encounters_order_positive")),
        sa.ForeignKeyConstraint(
            ["competition_id"],
            ["competitions.id"],
            name=op.f("fk_team_encounters_competition_id_competitions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["team1_id", "competition_id"],
            ["competition_teams.id", "competition_teams.competition_id"],
            name="team_encounter_team1_identity",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["team2_id", "competition_id"],
            ["competition_teams.id", "competition_teams.competition_id"],
            name="team_encounter_team2_identity",
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_team_encounters")),
        sa.UniqueConstraint("competition_id", "team1_id", "team2_id", name="team_encounter_pair"),
        sa.UniqueConstraint(
            "competition_id", "round_no", "order_no", name="team_encounter_round_order"
        ),
    )
    op.create_index(
        op.f("ix_team_encounters_competition_id"),
        "team_encounters",
        ["competition_id"],
        unique=False,
    )

    op.create_table(
        "team_doubles_games",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("encounter_id", sa.Integer(), nullable=False),
        sa.Column("team1_player1_id", sa.Integer(), nullable=False),
        sa.Column("team1_player2_id", sa.Integer(), nullable=False),
        sa.Column("team2_player1_id", sa.Integer(), nullable=False),
        sa.Column("team2_player2_id", sa.Integer(), nullable=False),
        sa.Column("score1", sa.SmallInteger(), nullable=True),
        sa.Column("score2", sa.SmallInteger(), nullable=True),
        sa.Column("played_on", sa.Date(), nullable=True),
        sa.Column("submitted_by_id", sa.Integer(), nullable=True),
        sa.Column("updated_by_id", sa.Integer(), nullable=True),
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
        sa.CheckConstraint(
            "team1_player1_id < team1_player2_id",
            name=op.f("ck_team_doubles_games_team1_player_order"),
        ),
        sa.CheckConstraint(
            "team2_player1_id < team2_player2_id",
            name=op.f("ck_team_doubles_games_team2_player_order"),
        ),
        sa.CheckConstraint(
            "(score1 IS NULL AND score2 IS NULL AND played_on IS NULL) OR "
            "((score1 = 3 AND score2 = 0) OR (score1 = 0 AND score2 = 3) OR "
            "(score1 = 2 AND score2 = 1) OR (score1 = 1 AND score2 = 2)) "
            "AND played_on IS NOT NULL",
            name=op.f("ck_team_doubles_games_allowed_score"),
        ),
        sa.ForeignKeyConstraint(
            ["encounter_id"],
            ["team_encounters.id"],
            name=op.f("fk_team_doubles_games_encounter_id_team_encounters"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["submitted_by_id"],
            ["users.id"],
            name=op.f("fk_team_doubles_games_submitted_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["team1_player1_id"],
            ["users.id"],
            name=op.f("fk_team_doubles_games_team1_player1_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["team1_player2_id"],
            ["users.id"],
            name=op.f("fk_team_doubles_games_team1_player2_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["team2_player1_id"],
            ["users.id"],
            name=op.f("fk_team_doubles_games_team2_player1_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["team2_player2_id"],
            ["users.id"],
            name=op.f("fk_team_doubles_games_team2_player2_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_id"],
            ["users.id"],
            name=op.f("fk_team_doubles_games_updated_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_team_doubles_games")),
        sa.UniqueConstraint("encounter_id", name=op.f("uq_team_doubles_games_encounter_id")),
    )

    op.create_table(
        "team_single_games",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("encounter_id", sa.Integer(), nullable=False),
        sa.Column("sequence", sa.SmallInteger(), nullable=False),
        sa.Column("team1_player_id", sa.Integer(), nullable=False),
        sa.Column("team2_player_id", sa.Integer(), nullable=False),
        sa.Column("match_id", sa.Integer(), nullable=False),
        sa.CheckConstraint(
            "sequence BETWEEN 1 AND 4", name=op.f("ck_team_single_games_sequence_range")
        ),
        sa.ForeignKeyConstraint(
            ["encounter_id"],
            ["team_encounters.id"],
            name=op.f("fk_team_single_games_encounter_id_team_encounters"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["match_id"],
            ["matches.id"],
            name=op.f("fk_team_single_games_match_id_matches"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["team1_player_id"],
            ["users.id"],
            name=op.f("fk_team_single_games_team1_player_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["team2_player_id"],
            ["users.id"],
            name=op.f("fk_team_single_games_team2_player_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_team_single_games")),
        sa.UniqueConstraint("encounter_id", "sequence", name="team_single_sequence"),
        sa.UniqueConstraint("encounter_id", "team1_player_id", name="team_single_team1_player"),
        sa.UniqueConstraint("encounter_id", "team2_player_id", name="team_single_team2_player"),
        sa.UniqueConstraint("match_id", name=op.f("uq_team_single_games_match_id")),
    )
    op.create_index(
        op.f("ix_team_single_games_encounter_id"),
        "team_single_games",
        ["encounter_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index(op.f("ix_team_single_games_encounter_id"), table_name="team_single_games")
    op.drop_table("team_single_games")
    op.drop_table("team_doubles_games")
    op.drop_index(op.f("ix_team_encounters_competition_id"), table_name="team_encounters")
    op.drop_table("team_encounters")
    op.drop_index(
        op.f("ix_competition_team_members_team_id"), table_name="competition_team_members"
    )
    op.drop_table("competition_team_members")
    op.drop_index(op.f("ix_league_fixtures_competition_id"), table_name="league_fixtures")
    op.drop_table("league_fixtures")
    op.drop_index(op.f("ix_competition_teams_competition_id"), table_name="competition_teams")
    op.drop_table("competition_teams")

    with op.batch_alter_table("matches") as batch_op:
        batch_op.drop_constraint(op.f("ck_matches_competition_link"), type_="check")

    with op.batch_alter_table("competition_members") as batch_op:
        batch_op.add_column(sa.Column("position", sa.SmallInteger(), nullable=True))
        batch_op.create_check_constraint(
            op.f("ck_competition_members_position_positive"),
            "position IS NULL OR position > 0",
        )

    with op.batch_alter_table("competitions") as batch_op:
        batch_op.drop_constraint(op.f("ck_competitions_completion_state"), type_="check")
        batch_op.drop_constraint(op.f("ck_competitions_competition_type"), type_="check")
        batch_op.alter_column(
            "type",
            existing_type=sa.String(length=6),
            type_=sa.Enum(
                "league",
                "tournament",
                name="competition_type",
                native_enum=False,
                create_constraint=False,
            ),
            existing_nullable=False,
        )
        batch_op.drop_column("completed_at")
    op.execute("UPDATE competitions SET type = 'tournament' WHERE type = 'team'")
    with op.batch_alter_table("competitions") as batch_op:
        batch_op.create_check_constraint(
            op.f("ck_competitions_competition_type"),
            "type IN ('league', 'tournament')",
        )
