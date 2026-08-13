"""Create the initial Scutta schema.

Revision ID: 20260813_0001
Revises:
Create Date: 2026-08-13
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260813_0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column(
            "role",
            sa.Enum(
                "player",
                "admin",
                name="user_role",
                native_enum=False,
                create_constraint=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "gender",
            sa.Enum(
                "M",
                "F",
                name="gender",
                native_enum=False,
                create_constraint=False,
            ),
            nullable=True,
        ),
        sa.Column("is_freshman", sa.Boolean(), nullable=False),
        sa.Column("club_rank", sa.SmallInteger(), nullable=True),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.Column("auth_version", sa.Integer(), nullable=False),
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
            "club_rank IS NULL OR club_rank > 0",
            name=op.f("ck_users_club_rank_positive"),
        ),
        sa.CheckConstraint(
            "auth_version > 0",
            name=op.f("ck_users_auth_version_positive"),
        ),
        sa.CheckConstraint("role IN ('player', 'admin')", name=op.f("ck_users_user_role")),
        sa.CheckConstraint("gender IN ('M', 'F')", name=op.f("ck_users_gender")),
        sa.CheckConstraint(
            "role = 'admin' OR (gender IS NOT NULL AND club_rank IS NOT NULL)",
            name=op.f("ck_users_player_profile_required"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("username", name=op.f("uq_users_username")),
    )
    op.create_index(op.f("ix_users_is_active"), "users", ["is_active"], unique=False)

    op.create_table(
        "competitions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column(
            "type",
            sa.Enum(
                "league",
                "tournament",
                name="competition_type",
                native_enum=False,
                create_constraint=False,
            ),
            nullable=False,
        ),
        sa.Column(
            "status",
            sa.Enum(
                "active",
                "completed",
                name="competition_status",
                native_enum=False,
                create_constraint=False,
            ),
            nullable=False,
        ),
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
            "type IN ('league', 'tournament')",
            name=op.f("ck_competitions_competition_type"),
        ),
        sa.CheckConstraint(
            "status IN ('active', 'completed')",
            name=op.f("ck_competitions_competition_status"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_competitions")),
    )

    op.create_table(
        "auth_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("auth_version", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("CURRENT_TIMESTAMP"),
            nullable=False,
        ),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_auth_sessions_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_auth_sessions")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_auth_sessions_token_hash")),
    )
    op.create_index(
        op.f("ix_auth_sessions_expires_at"),
        "auth_sessions",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        op.f("ix_auth_sessions_user_id"),
        "auth_sessions",
        ["user_id"],
        unique=False,
    )

    op.create_table(
        "competition_members",
        sa.Column("competition_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("position", sa.SmallInteger(), nullable=True),
        sa.CheckConstraint(
            "position IS NULL OR position > 0",
            name=op.f("ck_competition_members_position_positive"),
        ),
        sa.ForeignKeyConstraint(
            ["competition_id"],
            ["competitions.id"],
            name=op.f("fk_competition_members_competition_id_competitions"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_competition_members_user_id_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "competition_id",
            "user_id",
            name=op.f("pk_competition_members"),
        ),
    )

    op.create_table(
        "matches",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("competition_id", sa.Integer(), nullable=True),
        sa.Column("player1_id", sa.Integer(), nullable=False),
        sa.Column("player2_id", sa.Integer(), nullable=False),
        sa.Column("score1", sa.SmallInteger(), nullable=False),
        sa.Column("score2", sa.SmallInteger(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "casual",
                "daily",
                "competition",
                name="match_kind",
                native_enum=False,
                create_constraint=False,
            ),
            nullable=False,
        ),
        sa.Column("played_on", sa.Date(), nullable=False),
        sa.Column("submitted_by_id", sa.Integer(), nullable=False),
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
            "player1_id < player2_id",
            name=op.f("ck_matches_canonical_player_order"),
        ),
        sa.CheckConstraint(
            "kind IN ('casual', 'daily', 'competition')",
            name=op.f("ck_matches_match_kind"),
        ),
        sa.CheckConstraint(
            "(score1 = 3 AND score2 = 0) OR "
            "(score1 = 0 AND score2 = 3) OR "
            "(score1 = 2 AND score2 = 1) OR "
            "(score1 = 1 AND score2 = 2)",
            name=op.f("ck_matches_allowed_score"),
        ),
        sa.ForeignKeyConstraint(
            ["competition_id"],
            ["competitions.id"],
            name=op.f("fk_matches_competition_id_competitions"),
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["player1_id"],
            ["users.id"],
            name=op.f("fk_matches_player1_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["player2_id"],
            ["users.id"],
            name=op.f("fk_matches_player2_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["submitted_by_id"],
            ["users.id"],
            name=op.f("fk_matches_submitted_by_id_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["updated_by_id"],
            ["users.id"],
            name=op.f("fk_matches_updated_by_id_users"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_matches")),
        sa.UniqueConstraint(
            "played_on",
            "player1_id",
            "player2_id",
            name="daily_player_pair",
        ),
    )
    op.create_index(
        "ix_matches_player1_played_on",
        "matches",
        ["player1_id", "played_on"],
        unique=False,
    )
    op.create_index(
        "ix_matches_player2_played_on",
        "matches",
        ["player2_id", "played_on"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_matches_player2_played_on", table_name="matches")
    op.drop_index("ix_matches_player1_played_on", table_name="matches")
    op.drop_table("matches")
    op.drop_table("competition_members")
    op.drop_index(op.f("ix_auth_sessions_user_id"), table_name="auth_sessions")
    op.drop_index(op.f("ix_auth_sessions_expires_at"), table_name="auth_sessions")
    op.drop_table("auth_sessions")
    op.drop_table("competitions")
    op.drop_index(op.f("ix_users_is_active"), table_name="users")
    op.drop_table("users")
