from __future__ import annotations

from types import SimpleNamespace
from typing import cast
from uuid import uuid4

import pytest
from fastapi import HTTPException
from psycopg.errors import DeadlockDetected, LockNotAvailable
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.admin import _lock_database_for_reset
from app.core.database import Base, get_db
from app.main import app
from app.schemas.admin import DATABASE_RESET_CONFIRMATION


class _LockSession:
    def __init__(self, dialect: str, failure: Exception | None = None) -> None:
        self.bind = SimpleNamespace(dialect=SimpleNamespace(name=dialect))
        self.failure = failure
        self.statements: list[str] = []
        self.rollbacks = 0

    def get_bind(self):
        return self.bind

    def execute(self, statement):
        self.statements.append(str(statement))
        if self.failure is not None:
            raise self.failure

    def rollback(self) -> None:
        self.rollbacks += 1


def test_database_reset_lock_is_nonblocking_only_on_postgresql() -> None:
    postgres = _LockSession("postgresql")
    _lock_database_for_reset(cast(Session, postgres))
    assert len(postgres.statements) == 1
    assert postgres.statements[0].endswith("IN ACCESS EXCLUSIVE MODE NOWAIT")
    assert "users, auth_sessions" in postgres.statements[0]
    assert postgres.rollbacks == 0

    sqlite = _LockSession("sqlite")
    _lock_database_for_reset(cast(Session, sqlite))
    assert sqlite.statements == []
    assert sqlite.rollbacks == 0


def test_database_reset_lock_rolls_back_only_known_lock_contention() -> None:
    failure = OperationalError("LOCK TABLE", {}, LockNotAvailable("busy"))
    session = _LockSession("postgresql", failure)
    with pytest.raises(HTTPException) as caught:
        _lock_database_for_reset(cast(Session, session))
    assert caught.value.status_code == 409
    assert caught.value.detail == "다른 요청이 처리 중입니다. 잠시 후 다시 초기화해 주세요."
    assert session.rollbacks == 1

    unexpected = OperationalError("LOCK TABLE", {}, DeadlockDetected("unexpected"))
    session = _LockSession("postgresql", unexpected)
    with pytest.raises(OperationalError) as propagated:
        _lock_database_for_reset(cast(Session, session))
    assert propagated.value is unexpected
    assert session.rollbacks == 0


def _database_rows(api) -> dict[str, list[tuple]]:
    with api.session_factory() as db:
        return {
            table.name: [
                tuple(row)
                for row in db.execute(table.select().order_by(*table.primary_key.columns)).all()
            ]
            for table in Base.metadata.sorted_tables
        }


def test_database_reset_contention_preserves_all_rows_and_allows_retry(api, monkeypatch) -> None:
    api.create_admin()
    admin = api.client()
    api.login(admin, "admin", "admin-password")
    players = []
    for index in range(4):
        response = admin.post(
            "/api/v1/admin/players",
            json={
                "username": f"초기화경합{index}",
                "password": "player-password",
                "gender": "M",
                "club_rank": 4,
            },
        )
        assert response.status_code == 201, response.text
        players.append(response.json())
    player = api.client()
    api.login(player, players[0]["username"], "player-password")
    assert (
        admin.post(
            "/api/v1/admin/competitions",
            json={
                "name": "보존할 대회",
                "type": "league",
                "participant_ids": [entry["id"] for entry in players],
            },
        ).status_code
        == 201
    )
    assert (
        player.post(
            "/api/v1/matches",
            json={"opponent_id": players[1]["id"], "my_score": 3, "opponent_score": 0},
        ).status_code
        == 201
    )
    assert player.post("/api/v1/minigames/coin-flip/start").status_code == 200
    assert (
        player.post("/api/v1/minigames/paddle-flight/score", json={"score": 12}).status_code == 200
    )
    assert (
        player.post(
            "/api/v1/minigames/paddle-flight/cosmetics/chests", json={"claim_id": str(uuid4())}
        ).status_code
        == 200
    )
    before = _database_rows(api)
    lock_statements: list[str] = []
    rollbacks: list[bool] = []

    class ContendedSession:
        # Real isolated SQLite transactions verify the route's no-delete/retry
        # behavior; only PostgreSQL's unsupported LOCK statement is simulated.
        def __init__(self, session: Session) -> None:
            self.session = session

        def __getattr__(self, name):
            return getattr(self.session, name)

        def get_bind(self):
            return SimpleNamespace(dialect=SimpleNamespace(name="postgresql"))

        def execute(self, statement, *args, **kwargs):
            if str(statement).startswith("LOCK TABLE "):
                lock_statements.append(str(statement))
                if len(lock_statements) == 1:
                    raise OperationalError(str(statement), {}, LockNotAvailable("busy"))
                return None
            return self.session.execute(statement, *args, **kwargs)

        def rollback(self) -> None:
            rollbacks.append(True)
            self.session.rollback()

    def contended_db():
        with api.session_factory() as db:
            yield ContendedSession(db)

    monkeypatch.setitem(app.dependency_overrides, get_db, contended_db)
    payload = {
        "confirmation": DATABASE_RESET_CONFIRMATION,
        "admin_password": "admin-password",
    }
    rejected = admin.post("/api/v1/admin/database/reset", json=payload)
    assert rejected.status_code == 409, rejected.text
    assert rejected.json()["detail"] == "다른 요청이 처리 중입니다. 잠시 후 다시 초기화해 주세요."
    assert rollbacks == [True]
    assert _database_rows(api) == before
    assert player.get("/api/v1/auth/me").status_code == 200

    retried = admin.post("/api/v1/admin/database/reset", json=payload)
    assert retried.status_code == 200, retried.text
    assert retried.json()["deleted"]["players"] == 4
    assert retried.json()["deleted"]["matches"] == 1
    assert retried.json()["deleted"]["competitions"] == 1
    assert len(lock_statements) == 2
    assert admin.get("/api/v1/auth/me").status_code == 200
    assert player.get("/api/v1/auth/me").status_code == 401
    after = _database_rows(api)
    assert len(after["users"]) == len(after["auth_sessions"]) == 1
    assert all(
        not rows
        for name, rows in after.items()
        if name not in {"users", "auth_sessions", "settlement_settings"}
    )
