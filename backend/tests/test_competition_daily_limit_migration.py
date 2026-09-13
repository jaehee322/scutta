from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from importlib import import_module
from io import StringIO
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import inspect, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import create_database_engine
from app.models import AuthSession, Gender, Match, MatchKind, User, UserRole
from app.schemas.competitions import CompetitionCreate, TeamInput
from app.services import competitions as service

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PREVIOUS = "20260911_0013"
REVISION = "20260913_0014"


def _saved_rows(engine):
    with engine.connect() as connection:
        return {
            table: sorted(
                (tuple(row) for row in connection.execute(text(f'SELECT * FROM "{table}"'))),
                key=repr,
            )
            for table in inspect(connection).get_table_names()
            if table != "alembic_version"
        }


def _schema_rows(engine):
    with engine.connect() as connection:
        return connection.execute(
            text("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name")
        ).all()


def _assert_healthy(engine):
    with engine.connect() as connection:
        assert connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1
        assert connection.exec_driver_sql("PRAGMA foreign_key_check").all() == []
        assert connection.exec_driver_sql("PRAGMA integrity_check").scalar() == "ok"


@pytest.fixture
def legacy_matches(tmp_path, monkeypatch):
    database_url = f"sqlite:///{(tmp_path / 'daily-limit.db').as_posix()}"
    monkeypatch.setenv("DATABASE_URL", database_url)
    get_settings.cache_clear()
    config = Config(str(PROJECT_ROOT / "alembic.ini"))
    engine = create_database_engine(database_url)
    try:
        command.upgrade(config, PREVIOUS)
        with Session(engine, expire_on_commit=False) as db:
            db.add_all(
                User(
                    id=number,
                    username=f"preserved-player-{number}",
                    password_hash="preserved-password",
                    gender=Gender.MALE,
                    club_rank=3,
                )
                for number in range(1, 9)
            )
            admin = User(
                id=9, username="preserved-admin", password_hash="admin-hash", role=UserRole.ADMIN
            )
            db.add(admin)
            db.commit()
            now = datetime(2026, 9, 13, 3, 0, tzinfo=UTC)
            db.add(
                AuthSession(
                    user_id=1,
                    token_hash="a" * 64,
                    auth_version=1,
                    last_seen_at=now,
                    expires_at=now + timedelta(days=30),
                )
            )
            db.add(
                Match(
                    player1_id=1,
                    player2_id=2,
                    score1=3,
                    score2=0,
                    kind=MatchKind.CASUAL,
                    played_on=date(2026, 8, 3),
                    played_at=now,
                )
            )
            db.commit()
            league_id = service.create_competition(
                db,
                payload=CompetitionCreate(
                    name="preserved-league", type="league", participant_ids=[1, 2, 3, 4]
                ),
            )
            fixture = service.get_competition_detail(db, league_id, actor_id=None).fixtures[0]
            service.put_admin_league_result(
                db,
                competition_id=league_id,
                fixture_id=fixture.id,
                score1=2,
                score2=1,
                played_on=date(2026, 8, 1),
            )
            team_id = service.create_competition(
                db,
                payload=CompetitionCreate(
                    name="preserved-team",
                    type="team",
                    teams=[
                        TeamInput(name="A", member_ids=[1, 2, 3, 4]),
                        TeamInput(name="B", member_ids=[5, 6, 7, 8]),
                    ],
                ),
            )
            encounter = service.get_competition_detail(db, team_id, actor_id=None).encounters[0]
            for index in range(4):
                service.post_admin_team_single(
                    db,
                    competition_id=team_id,
                    encounter_id=encounter.id,
                    team1_player_id=index + 1,
                    team2_player_id=index + 5,
                    score1=3 if index < 2 else 0,
                    score2=0 if index < 2 else 3,
                    played_on=date(2026, 8, 2),
                )
            service.put_admin_team_doubles(
                db,
                competition_id=team_id,
                encounter_id=encounter.id,
                admin=admin,
                score1=2,
                score2=1,
                played_on=date(2026, 8, 2),
            )
        yield config, engine, league_id, team_id
    finally:
        engine.dispose()
        get_settings.cache_clear()


def test_daily_limit_migration_preserves_all_rows_and_round_trips(legacy_matches):
    config, engine, _, _ = legacy_matches
    before = _saved_rows(engine)
    for table in (
        "matches",
        "league_fixtures",
        "team_single_games",
        "team_doubles_games",
        "auth_sessions",
    ):
        assert before[table], table

    command.upgrade(config, "head")
    assert _saved_rows(engine) == before
    index = next(
        item
        for item in inspect(engine).get_indexes("matches")
        if item["name"] == "daily_player_pair"
    )
    assert index["unique"]
    assert index["column_names"] == ["played_on", "player1_id", "player2_id"]
    assert str(index["dialect_options"]["sqlite_where"]) == "competition_id IS NULL"
    _assert_healthy(engine)
    command.check(config)

    command.downgrade(config, PREVIOUS)
    assert _saved_rows(engine) == before
    assert any(
        item["name"] == "daily_player_pair"
        for item in inspect(engine).get_unique_constraints("matches")
    )
    _assert_healthy(engine)


def test_partial_index_allows_competitions_and_blocks_unsafe_downgrade(legacy_matches):
    config, engine, league_id, team_id = legacy_matches
    command.upgrade(config, "head")

    def add_match(kind, competition_id, played_on):
        with engine.begin() as connection:
            connection.execute(
                text(
                    "INSERT INTO matches "
                    "(player1_id, player2_id, score1, score2, kind, played_on, competition_id) "
                    "VALUES (1, 2, 3, 0, :kind, :played_on, :competition_id)"
                ),
                {"kind": kind, "played_on": played_on, "competition_id": competition_id},
            )

    # An existing regular result does not consume a competition's same-day result.
    add_match("competition", league_id, "2026-08-03")
    add_match("competition", team_id, "2026-08-03")
    # Nor does a competition prevent the first regular result on another day.
    add_match("competition", league_id, "2026-08-04")
    add_match("competition", league_id, "2026-08-04")
    add_match("casual", None, "2026-08-04")
    for kind in ("casual", "daily"):
        with pytest.raises(IntegrityError):
            add_match(kind, None, "2026-08-03")
        with pytest.raises(IntegrityError):
            add_match(kind, None, "2026-08-04")

    before = _saved_rows(engine)
    before_schema = _schema_rows(engine)
    with pytest.raises(RuntimeError, match="duplicate same-day player pairs"):
        command.downgrade(config, PREVIOUS)
    assert _saved_rows(engine) == before
    assert _schema_rows(engine) == before_schema
    with engine.connect() as connection:
        assert connection.scalar(text("SELECT version_num FROM alembic_version")) == REVISION
    _assert_healthy(engine)


@pytest.mark.parametrize("direction", ["upgrade", "downgrade"])
def test_daily_limit_migration_rejects_fk_enabled_before_ddl(legacy_matches, direction):
    config, engine, _, _ = legacy_matches
    if direction == "downgrade":
        command.upgrade(config, "head")
    before = _saved_rows(engine)
    before_schema = _schema_rows(engine)
    migration = import_module("migrations.versions.20260913_0014_exempt_competition_daily_limit")
    with engine.connect() as connection:
        context = MigrationContext.configure(connection)
        with Operations.context(context), pytest.raises(RuntimeError, match="foreign_keys=OFF"):
            getattr(migration, direction)()
    assert _saved_rows(engine) == before
    assert _schema_rows(engine) == before_schema
    _assert_healthy(engine)


def test_daily_limit_postgres_offline_upgrade_and_downgrade_preflight(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgresql+psycopg://unused:unused@localhost/unused")
    get_settings.cache_clear()
    output = StringIO()
    config = Config(str(PROJECT_ROOT / "alembic.ini"), output_buffer=output)
    try:
        command.upgrade(config, f"{PREVIOUS}:{REVISION}", sql=True)
        sql = output.getvalue()
        assert "ALTER TABLE matches DROP CONSTRAINT daily_player_pair" in sql
        assert (
            "CREATE UNIQUE INDEX daily_player_pair ON matches (played_on, player1_id, player2_id) "
            "WHERE competition_id IS NULL"
        ) in sql
        assert "DROP TABLE" not in sql
        output.seek(0)
        output.truncate()
        with pytest.raises(RuntimeError, match="online checks for duplicate matches"):
            command.downgrade(config, f"{REVISION}:{PREVIOUS}", sql=True)
        assert "DROP INDEX" not in output.getvalue()
        assert "ALTER TABLE" not in output.getvalue()
    finally:
        get_settings.cache_clear()
