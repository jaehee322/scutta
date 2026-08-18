from __future__ import annotations

from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text

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
                "league_fixtures",
                "competition_teams",
                "competition_team_members",
                "team_encounters",
                "team_single_games",
                "team_doubles_games",
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
            user_checks = {
                constraint["name"] for constraint in schema.get_check_constraints("users")
            }
            assert "ck_users_club_rank_range" in user_checks
            assert "ck_users_club_rank_positive" not in user_checks
            assert any(
                constraint["name"] == "daily_player_pair"
                for constraint in schema.get_unique_constraints("matches")
            )
            assert "ck_matches_competition_link" in {
                constraint["name"] for constraint in schema.get_check_constraints("matches")
            }
            assert "ck_competitions_completion_state" in {
                constraint["name"] for constraint in schema.get_check_constraints("competitions")
            }
            assert "completed_at" in {
                column["name"] for column in schema.get_columns("competitions")
            }
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
                "league_fixtures",
                "competition_teams",
                "competition_team_members",
                "team_encounters",
                "team_single_games",
                "team_doubles_games",
            }
        finally:
            engine.dispose()
    finally:
        get_settings.cache_clear()


def test_club_rank_migration_normalizes_legacy_outlier(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "legacy-rank.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    get_settings.cache_clear()

    config = Config(str(PROJECT_ROOT / "alembic.ini"))
    try:
        command.upgrade(config, "20260816_0002")
        engine = create_engine(database_url)
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users "
                    "(username, password_hash, role, gender, is_freshman, club_rank, auth_version) "
                    "VALUES ('legacy', 'hash', 'player', 'M', 0, 7, 1)"
                )
            )
        engine.dispose()

        command.upgrade(config, "head")
        engine = create_engine(database_url)
        try:
            with engine.connect() as connection:
                assert (
                    connection.scalar(text("SELECT club_rank FROM users WHERE username = 'legacy'"))
                    == 6
                )
        finally:
            engine.dispose()
    finally:
        get_settings.cache_clear()


def test_competition_migration_rejects_legacy_scaffolding_rows(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "legacy-competition.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    get_settings.cache_clear()

    config = Config(str(PROJECT_ROOT / "alembic.ini"))
    try:
        command.upgrade(config, "20260818_0003")
        engine = create_engine(database_url)
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO competitions (name, type, status) "
                    "VALUES ('legacy', 'league', 'active')"
                )
            )
        engine.dispose()

        with pytest.raises(RuntimeError, match="legacy rows"):
            command.upgrade(config, "head")

        engine = create_engine(database_url)
        try:
            with engine.connect() as connection:
                assert connection.scalar(text("SELECT version_num FROM alembic_version")) == (
                    "20260818_0003"
                )
                assert connection.scalar(text("SELECT COUNT(*) FROM competitions")) == 1
        finally:
            engine.dispose()
    finally:
        get_settings.cache_clear()
