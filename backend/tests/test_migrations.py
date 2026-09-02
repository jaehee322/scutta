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
                "settlement_settings",
                "coin_flip_states",
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
            match_columns = {column["name"] for column in schema.get_columns("matches")}
            assert "played_at" in match_columns
            assert {
                "submitted_by_id",
                "updated_by_id",
                "created_at",
                "updated_at",
            }.isdisjoint(match_columns)
            assert "ck_matches_competition_link" in {
                constraint["name"] for constraint in schema.get_check_constraints("matches")
            }
            assert "ck_competitions_completion_state" in {
                constraint["name"] for constraint in schema.get_check_constraints("competitions")
            }
            assert "completed_at" in {
                column["name"] for column in schema.get_columns("competitions")
            }
            assert "played_at" in {
                column["name"] for column in schema.get_columns("team_doubles_games")
            }
            assert {
                "user_id",
                "active",
                "run_id",
                "current_streak",
                "best_streak",
                "best_achieved_at",
                "last_flip_at",
                "daily_attempt_date",
                "daily_attempts_used",
            } == {
                column["name"] for column in schema.get_columns("coin_flip_states")
            }
            coin_foreign_keys = schema.get_foreign_keys("coin_flip_states")
            assert len(coin_foreign_keys) == 1
            assert coin_foreign_keys[0]["referred_table"] == "users"
            assert coin_foreign_keys[0]["options"].get("ondelete") == "CASCADE"
            assert {
                "ck_coin_flip_states_best_achievement_time",
                "ck_coin_flip_states_best_streak_nonnegative",
                "ck_coin_flip_states_current_not_above_best",
                "ck_coin_flip_states_current_streak_nonnegative",
                "ck_coin_flip_states_daily_attempts_date_consistency",
                "ck_coin_flip_states_daily_attempts_range",
                "ck_coin_flip_states_inactive_streak_zero",
                "ck_coin_flip_states_run_id_positive",
            } <= {
                constraint["name"]
                for constraint in schema.get_check_constraints("coin_flip_states")
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
                "settlement_settings",
                "coin_flip_states",
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


def test_played_at_migrations_preserve_match_time_and_leave_doubles_unknown(
    tmp_path, monkeypatch
) -> None:
    database_path = tmp_path / "legacy-match-time.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    get_settings.cache_clear()

    config = Config(str(PROJECT_ROOT / "alembic.ini"))
    try:
        command.upgrade(config, "20260818_0004")
        engine = create_engine(database_url)
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users "
                    "(id, username, password_hash, role, gender, is_freshman, club_rank, "
                    "auth_version) VALUES "
                    "(1, 'legacy-a', 'hash', 'player', 'M', 0, 4, 1), "
                    "(2, 'legacy-b', 'hash', 'player', 'F', 0, 6, 1), "
                    "(3, 'legacy-c', 'hash', 'player', 'M', 0, 4, 1), "
                    "(4, 'legacy-d', 'hash', 'player', 'F', 0, 6, 1)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO matches "
                    "(player1_id, player2_id, score1, score2, kind, played_on, "
                    "submitted_by_id, created_at, updated_at) "
                    "VALUES (1, 2, 3, 0, 'casual', '2026-08-20', 1, "
                    "'2026-08-20 07:35:00', '2026-08-20 07:40:00')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO competitions (id, name, type, status) "
                    "VALUES (1, 'legacy-team', 'team', 'active')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO competition_teams (id, competition_id, name) "
                    "VALUES (1, 1, 'A'), (2, 1, 'B')"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO team_encounters "
                    "(id, competition_id, team1_id, team2_id, round_no, order_no) "
                    "VALUES (1, 1, 1, 2, 1, 1)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO team_doubles_games "
                    "(encounter_id, team1_player1_id, team1_player2_id, "
                    "team2_player1_id, team2_player2_id, score1, score2, played_on, "
                    "submitted_by_id) "
                    "VALUES (1, 1, 2, 3, 4, 3, 0, '2026-08-20', 1)"
                )
            )
        engine.dispose()

        command.upgrade(config, "head")
        engine = create_engine(database_url)
        try:
            with engine.connect() as connection:
                assert connection.scalar(
                    text("SELECT CAST(played_at AS TEXT) FROM matches")
                ).startswith("2026-08-20 07:35:00")
                assert connection.scalar(
                    text("SELECT played_at FROM team_doubles_games")
                ) is None
        finally:
            engine.dispose()

        command.downgrade(config, "20260818_0004")
        engine = create_engine(database_url)
        try:
            schema = inspect(engine)
            match_columns = {column["name"] for column in schema.get_columns("matches")}
            doubles_columns = {
                column["name"] for column in schema.get_columns("team_doubles_games")
            }
            assert "created_at" in match_columns
            assert "played_at" not in match_columns
            assert "played_at" not in doubles_columns
            with engine.connect() as connection:
                assert connection.scalar(
                    text("SELECT CAST(created_at AS TEXT) FROM matches")
                ).startswith("2026-08-20 07:35:00")
        finally:
            engine.dispose()
    finally:
        get_settings.cache_clear()


def test_played_at_migration_supports_earlier_untracked_0006(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "old-0006.db"
    database_url = f"sqlite:///{database_path.as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    get_settings.cache_clear()

    config = Config(str(PROJECT_ROOT / "alembic.ini"))
    try:
        command.upgrade(config, "20260824_0006")
        engine = create_engine(database_url)
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users "
                    "(id, username, password_hash, role, gender, is_freshman, club_rank, "
                    "auth_version) VALUES "
                    "(1, 'old-a', 'hash', 'player', 'M', 0, 4, 1), "
                    "(2, 'old-b', 'hash', 'player', 'F', 0, 6, 1)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO matches "
                    "(player1_id, player2_id, score1, score2, kind, played_on) "
                    "VALUES (1, 2, 3, 0, 'casual', '2026-08-20')"
                )
            )
            # Reproduce the schema produced by the earlier untracked 0006:
            # both created_at and played_at were absent while its revision id
            # was already recorded.
            connection.execute(text("ALTER TABLE matches DROP COLUMN played_at"))
        engine.dispose()

        command.upgrade(config, "head")
        engine = create_engine(database_url)
        try:
            schema = inspect(engine)
            played_at_column = next(
                column
                for column in schema.get_columns("matches")
                if column["name"] == "played_at"
            )
            assert played_at_column["nullable"] is True
            with engine.connect() as connection:
                assert connection.scalar(text("SELECT played_at FROM matches")) is None
        finally:
            engine.dispose()

        # Downgrading through the revised 0006 must also remain possible even
        # though the lost historical timestamp can only receive a fallback.
        command.downgrade(config, "20260818_0004")
        engine = create_engine(database_url)
        try:
            with engine.connect() as connection:
                assert connection.scalar(text("SELECT created_at FROM matches")) is not None
        finally:
            engine.dispose()
    finally:
        get_settings.cache_clear()
