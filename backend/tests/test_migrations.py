from __future__ import annotations

from datetime import UTC, datetime
from io import StringIO
from pathlib import Path
from uuid import uuid4

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import create_database_engine
from app.core.paddle_cosmetics import DEFAULT_PADDLE_EQUIPMENT
from app.models import Gender, PaddleFlightScore, User
from app.schemas.paddle_cosmetics import PaddleFlightEquipment
from app.services.paddle_cosmetics import (
    equip_paddle_cosmetics,
    get_paddle_cosmetics,
    open_paddle_chest,
)

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
                "paddle_flight_scores",
                "paddle_flight_cosmetics",
                "paddle_flight_owned_skins",
                "paddle_flight_chest_claims",
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
            } == {column["name"] for column in schema.get_columns("coin_flip_states")}
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
            assert {"user_id", "best_score", "best_achieved_at", "last_submitted_at"} == {
                column["name"] for column in schema.get_columns("paddle_flight_scores")
            }
            paddle_foreign_keys = schema.get_foreign_keys("paddle_flight_scores")
            assert len(paddle_foreign_keys) == 1
            assert paddle_foreign_keys[0]["referred_table"] == "users"
            assert paddle_foreign_keys[0]["options"].get("ondelete") == "CASCADE"
            assert {
                "ck_paddle_flight_scores_best_achievement_time",
                "ck_paddle_flight_scores_best_score_range",
            } <= {
                constraint["name"]
                for constraint in schema.get_check_constraints("paddle_flight_scores")
            }
            for table, parent in (
                ("paddle_flight_cosmetics", "users"),
                ("paddle_flight_owned_skins", "paddle_flight_cosmetics"),
                ("paddle_flight_chest_claims", "paddle_flight_cosmetics"),
            ):
                foreign_keys = schema.get_foreign_keys(table)
                assert len(foreign_keys) == 1
                assert foreign_keys[0]["referred_table"] == parent
                assert foreign_keys[0]["options"].get("ondelete") == "CASCADE"
            assert schema.get_pk_constraint("paddle_flight_owned_skins")["constrained_columns"] == [
                "user_id",
                "skin_id",
            ]
            assert schema.get_pk_constraint("paddle_flight_chest_claims")[
                "constrained_columns"
            ] == ["user_id", "claim_id"]
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
                "paddle_flight_scores",
                "paddle_flight_cosmetics",
                "paddle_flight_owned_skins",
                "paddle_flight_chest_claims",
            }
        finally:
            engine.dispose()
    finally:
        get_settings.cache_clear()


def test_cosmetics_migration_preserves_existing_users_scores_and_supports_downgrade(
    tmp_path, monkeypatch
) -> None:
    database_url = f"sqlite:///{(tmp_path / 'cosmetics-upgrade.db').as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setattr("app.services.paddle_cosmetics.choose_paddle_chest_skin", lambda: "bg_dawn")
    get_settings.cache_clear()
    config = Config(str(PROJECT_ROOT / "alembic.ini"))
    try:
        command.upgrade(config, "20260904_0010")
        engine = create_engine(database_url)
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO users "
                    "(id, username, password_hash, role, gender, is_freshman, "
                    "club_rank, auth_version) "
                    "VALUES (1, 'existing-player', 'unchanged-hash', 'player', 'M', 0, 4, 1)"
                )
            )
            connection.execute(
                text(
                    "INSERT INTO paddle_flight_scores "
                    "(user_id, best_score, best_achieved_at, last_submitted_at) "
                    "VALUES (1, 25, '2026-09-08 01:00:00', '2026-09-08 01:00:00')"
                )
            )
        engine.dispose()
        command.upgrade(config, "head")
        engine = create_engine(database_url)
        try:
            with Session(engine, expire_on_commit=False) as db:
                assert db.get(User, 1).password_hash == "unchanged-hash"
                score = db.get(PaddleFlightScore, 1)
                assert score.best_score == 25
                assert score.best_achieved_at == datetime(2026, 9, 8, 1, 0, tzinfo=UTC).replace(
                    tzinfo=None
                )
                cosmetics = get_paddle_cosmetics(db, user_id=1)
                assert cosmetics.opened_chests == 0
                assert cosmetics.owned == ["bg_classic", "paddle_classic", "ball_classic"]
                opened = open_paddle_chest(db, user_id=1, claim_id=uuid4())
                assert opened.cosmetics.opened_chests == 1
                assert opened.skin_id == "bg_dawn"
        finally:
            engine.dispose()
        command.check(config)
        command.downgrade(config, "20260904_0010")
        engine = create_engine(database_url)
        try:
            assert not {
                "paddle_flight_cosmetics",
                "paddle_flight_owned_skins",
                "paddle_flight_chest_claims",
            } & set(inspect(engine).get_table_names())
            with engine.connect() as connection:
                assert connection.scalar(text("SELECT best_score FROM paddle_flight_scores")) == 25
                assert (
                    connection.scalar(text("SELECT password_hash FROM users")) == "unchanged-hash"
                )
        finally:
            engine.dispose()
    finally:
        get_settings.cache_clear()


def test_cosmetics_migration_compiles_for_postgres_without_connecting(monkeypatch) -> None:
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://unused:unused@localhost/unused")
    get_settings.cache_clear()
    output = StringIO()
    config = Config(str(PROJECT_ROOT / "alembic.ini"), output_buffer=output)
    try:
        command.upgrade(config, "20260904_0010:head", sql=True)
        sql = output.getvalue()
        assert "CREATE TABLE paddle_flight_cosmetics" in sql
        assert "CREATE TABLE paddle_flight_owned_skins" in sql
        assert "CREATE TABLE paddle_flight_chest_claims" in sql
        assert "claim_id UUID NOT NULL" in sql
        assert sql.count("ON DELETE CASCADE") == 3
        for skin in (
            "bg_sakura",
            "bg_glacier",
            "paddle_maple",
            "paddle_titanium",
            "ball_berry",
            "ball_lagoon",
        ):
            assert skin in sql
        assert sql.count("DROP CONSTRAINT") == 5
    finally:
        get_settings.cache_clear()


def test_skin_expansion_upgrade_preserves_existing_collection_and_receipts(
    tmp_path, monkeypatch
) -> None:
    database_url = f"sqlite:///{(tmp_path / 'skin-expansion.db').as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setattr("app.services.paddle_cosmetics.choose_paddle_chest_skin", lambda: "bg_dawn")
    get_settings.cache_clear()
    config = Config(str(PROJECT_ROOT / "alembic.ini"))
    tables = ("paddle_flight_cosmetics", "paddle_flight_owned_skins", "paddle_flight_chest_claims")

    def saved_rows(engine):
        with engine.connect() as connection:
            return {
                table: sorted(
                    tuple(row) for row in connection.execute(text(f"SELECT * FROM {table}"))
                )
                for table in tables
            }

    engine = None
    try:
        command.upgrade(config, "20260909_0011")
        engine = create_database_engine(database_url)
        original_claim = uuid4()
        with Session(engine, expire_on_commit=False) as db:
            db.add(
                User(
                    id=1,
                    username="existing-skins",
                    password_hash="preserved",
                    gender=Gender.MALE,
                    club_rank=4,
                )
            )
            db.commit()
            assert open_paddle_chest(db, user_id=1, claim_id=original_claim).duplicate is False
            assert open_paddle_chest(db, user_id=1, claim_id=uuid4()).duplicate is True
            before_snapshot = equip_paddle_cosmetics(
                db,
                user_id=1,
                equipment=PaddleFlightEquipment(
                    **{**DEFAULT_PADDLE_EQUIPMENT, "background": "bg_dawn"}
                ),
            )
        before_rows = saved_rows(engine)
        engine.dispose()
        command.upgrade(config, "20260909_0012")
        engine = create_database_engine(database_url)
        assert saved_rows(engine) == before_rows
        with engine.connect() as connection:
            assert connection.scalar(text("PRAGMA foreign_keys")) == 1
            assert connection.execute(text("PRAGMA foreign_key_check")).all() == []
        with Session(engine, expire_on_commit=False) as db:
            assert get_paddle_cosmetics(db, user_id=1) == before_snapshot
            assert open_paddle_chest(db, user_id=1, claim_id=original_claim).duplicate is False
            equipment = before_snapshot.equipped.model_dump()
            for category, skin in (
                ("background", "bg_sakura"),
                ("background", "bg_glacier"),
                ("paddle", "paddle_maple"),
                ("paddle", "paddle_titanium"),
                ("ball", "ball_berry"),
                ("ball", "ball_lagoon"),
            ):
                monkeypatch.setattr(
                    "app.services.paddle_cosmetics.choose_paddle_chest_skin", lambda skin=skin: skin
                )
                opened = open_paddle_chest(db, user_id=1, claim_id=uuid4())
                assert opened.skin_id == skin and opened.duplicate is False
                equipment[category] = skin
                equipped = equip_paddle_cosmetics(
                    db, user_id=1, equipment=PaddleFlightEquipment(**equipment)
                )
                assert skin in equipped.owned
                assert "bg_dawn" in equipped.owned
            assert equipped.opened_chests == 8
        protected_rows = saved_rows(engine)
        engine.dispose()
        with pytest.raises(RuntimeError, match="expansion skins remain"):
            command.downgrade(config, "20260909_0011")
        engine = create_database_engine(database_url)
        assert saved_rows(engine) == protected_rows
        with engine.connect() as connection:
            assert (
                connection.scalar(text("SELECT version_num FROM alembic_version"))
                == "20260909_0012"
            )
            assert connection.execute(text("PRAGMA foreign_key_check")).all() == []
        command.check(config)
    finally:
        if engine is not None:
            engine.dispose()
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
                assert connection.scalar(text("SELECT played_at FROM team_doubles_games")) is None
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
                column for column in schema.get_columns("matches") if column["name"] == "played_at"
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
