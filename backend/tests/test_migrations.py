from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect

from app.core.config import get_settings

PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_alembic_schema_round_trip(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "migration.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    get_settings.cache_clear()

    config = Config(str(PROJECT_ROOT / "alembic.ini"))
    try:
        command.upgrade(config, "head")

        engine = create_engine(database_url)
        schema = inspect(engine)
        try:
            assert {
                "users",
                "auth_sessions",
                "matches",
                "competitions",
                "competition_members",
            } <= set(schema.get_table_names())
            assert any(
                constraint["column_names"] == ["username"]
                for constraint in schema.get_unique_constraints("users")
            )
            user_columns = {column["name"] for column in schema.get_columns("users")}
            assert {"auth_version", "gender", "club_rank"} <= user_columns
            assert "is_active" not in user_columns
            assert "ix_users_is_active" not in {
                index["name"] for index in schema.get_indexes("users")
            }
            assert any(
                constraint["name"] == "daily_player_pair"
                for constraint in schema.get_unique_constraints("matches")
            )
        finally:
            engine.dispose()

        command.check(config)
        command.downgrade(config, "base")

        engine = create_engine(database_url)
        try:
            remaining = set(inspect(engine).get_table_names())
            assert not remaining & {
                "users",
                "auth_sessions",
                "matches",
                "competitions",
                "competition_members",
            }
        finally:
            engine.dispose()
    finally:
        get_settings.cache_clear()
