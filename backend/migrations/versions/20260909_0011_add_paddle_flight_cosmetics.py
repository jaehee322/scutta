"""Persist paddle-flight skin ownership, equipment and idempotent chest claims.

Revision ID: 20260909_0011
Revises: 20260904_0010
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260909_0011"
down_revision: str | Sequence[str] | None = "20260904_0010"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Freeze this revision's catalog; future additions require their own migration.
SKINS = {
    "background": (
        "bg_classic",
        "bg_dawn",
        "bg_mint",
        "bg_coast",
        "bg_aurora",
        "bg_midnight",
        "bg_cosmos",
    ),
    "paddle": (
        "paddle_classic",
        "paddle_cobalt",
        "paddle_jade",
        "paddle_coral",
        "paddle_carbon",
        "paddle_amethyst",
        "paddle_imperial",
    ),
    "ball": (
        "ball_classic",
        "ball_tangerine",
        "ball_mint",
        "ball_sky",
        "ball_pearl",
        "ball_obsidian",
        "ball_solar",
    ),
}


def upgrade() -> None:
    op.create_table(
        "paddle_flight_cosmetics",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("background", sa.String(32), server_default="bg_classic", nullable=False),
        sa.Column("paddle", sa.String(32), server_default="paddle_classic", nullable=False),
        sa.Column("ball", sa.String(32), server_default="ball_classic", nullable=False),
        sa.Column("opened_chests", sa.Integer(), server_default="0", nullable=False),
        sa.CheckConstraint(
            "opened_chests >= 0", name=op.f("ck_paddle_flight_cosmetics_opened_chests_nonnegative")
        ),
        *(
            sa.CheckConstraint(
                f"{category} IN (" + ", ".join(repr(skin) for skin in skins) + ")",
                name=op.f(f"ck_paddle_flight_cosmetics_{category}_skin"),
            )
            for category, skins in SKINS.items()
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_paddle_flight_cosmetics_user_id_users"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_paddle_flight_cosmetics")),
    )
    chest_skins = ", ".join(repr(skin) for skins in SKINS.values() for skin in skins[1:])
    op.create_table(
        "paddle_flight_owned_skins",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("skin_id", sa.String(32), nullable=False),
        sa.CheckConstraint(
            f"skin_id IN ({chest_skins})", name=op.f("ck_paddle_flight_owned_skins_chest_skin")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["paddle_flight_cosmetics.user_id"],
            name=op.f("fk_paddle_flight_owned_skins_user_id_paddle_flight_cosmetics"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "skin_id", name=op.f("pk_paddle_flight_owned_skins")),
    )
    op.create_table(
        "paddle_flight_chest_claims",
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("claim_id", sa.Uuid(), nullable=False),
        sa.Column("skin_id", sa.String(32), nullable=False),
        sa.Column("duplicate", sa.Boolean(), nullable=False),
        sa.CheckConstraint(
            f"skin_id IN ({chest_skins})", name=op.f("ck_paddle_flight_chest_claims_chest_skin")
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["paddle_flight_cosmetics.user_id"],
            name=op.f("fk_paddle_flight_chest_claims_user_id_paddle_flight_cosmetics"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("user_id", "claim_id", name=op.f("pk_paddle_flight_chest_claims")),
    )


def downgrade() -> None:
    op.drop_table("paddle_flight_chest_claims")
    op.drop_table("paddle_flight_owned_skins")
    op.drop_table("paddle_flight_cosmetics")
