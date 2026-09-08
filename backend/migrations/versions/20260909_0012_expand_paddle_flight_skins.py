"""Allow six additional paddle-flight skins without changing existing collections.

Revision ID: 20260909_0012
Revises: 20260909_0011
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "20260909_0012"
down_revision: str | Sequence[str] | None = "20260909_0011"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

ORIGINAL_SKINS = {
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
ADDED_SKINS = {
    "background": ("bg_sakura", "bg_glacier"),
    "paddle": ("paddle_maple", "paddle_titanium"),
    "ball": ("ball_berry", "ball_lagoon"),
}


def _replace_checks(skins_by_category: dict[str, tuple[str, ...]]) -> None:
    connection = op.get_bind()
    if (
        connection.dialect.name == "sqlite"
        and connection.exec_driver_sql("PRAGMA foreign_keys").scalar()
    ):
        raise RuntimeError(
            "SQLite skin migration requires foreign_keys=OFF on the migration connection "
            "before recreating parent tables; no cosmetic records were changed."
        )
    # SQLite recreates these small tables; PostgreSQL replaces only the checks.
    with op.batch_alter_table("paddle_flight_cosmetics") as batch:
        for category, skins in skins_by_category.items():
            name = op.f(f"ck_paddle_flight_cosmetics_{category}_skin")
            batch.drop_constraint(name, type_="check")
            batch.create_check_constraint(
                name, f"{category} IN (" + ", ".join(repr(skin) for skin in skins) + ")"
            )
    chest_skins = ", ".join(
        repr(skin) for skins in skins_by_category.values() for skin in skins[1:]
    )
    for table in ("paddle_flight_owned_skins", "paddle_flight_chest_claims"):
        name = op.f(f"ck_{table}_chest_skin")
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(name, type_="check")
            batch.create_check_constraint(name, f"skin_id IN ({chest_skins})")


def upgrade() -> None:
    _replace_checks(
        {category: skins + ADDED_SKINS[category] for category, skins in ORIGINAL_SKINS.items()}
    )


def downgrade() -> None:
    # Removing a collected skin or an immutable receipt would lose account data.
    # Require a live preflight and fail before changing any constraints instead.
    if op.get_context().as_sql:
        raise RuntimeError("Paddle skin downgrade requires online checks for expansion skin data.")
    connection = op.get_bind()
    expanded = tuple(skin for skins in ADDED_SKINS.values() for skin in skins)
    cosmetics = sa.table(
        "paddle_flight_cosmetics", sa.column("background"), sa.column("paddle"), sa.column("ball")
    )
    equipment_uses_expansion = connection.scalar(
        sa.select(sa.literal(1))
        .select_from(cosmetics)
        .where(sa.or_(*(cosmetics.c[category].in_(expanded) for category in ORIGINAL_SKINS)))
        .limit(1)
    )
    expansion_exists = equipment_uses_expansion is not None
    for name in ("paddle_flight_owned_skins", "paddle_flight_chest_claims"):
        table = sa.table(name, sa.column("skin_id"))
        if (
            connection.scalar(
                sa.select(sa.literal(1))
                .select_from(table)
                .where(table.c.skin_id.in_(expanded))
                .limit(1)
            )
            is not None
        ):
            expansion_exists = True
    if expansion_exists:
        raise RuntimeError(
            "Cannot downgrade paddle skins while expansion skins remain in equipment, ownership, "
            "or chest receipts; preserve those records instead of removing them automatically."
        )
    _replace_checks(ORIGINAL_SKINS)
