from __future__ import annotations

import sqlite3
from datetime import date
from types import SimpleNamespace
from typing import cast
from unittest.mock import MagicMock

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from sqlalchemy.orm.exc import StaleDataError

from app.api.admin import _is_username_integrity_error
from app.models import Match, MatchKind, User
from app.services import matches as match_service


class PostgresIntegrityError(Exception):
    def __init__(self, sqlstate: str, constraint_name: str | None = None) -> None:
        super().__init__(sqlstate)
        self.sqlstate = sqlstate
        self.diag = SimpleNamespace(constraint_name=constraint_name)


def _integrity_error(original: BaseException) -> IntegrityError:
    return IntegrityError("statement", {}, original)


@pytest.mark.parametrize(
    ("error", "expected_type"),
    [
        (
            _integrity_error(PostgresIntegrityError("23505", "daily_player_pair")),
            match_service.DailyMatchConflictError,
        ),
        (
            _integrity_error(
                sqlite3.IntegrityError(
                    "UNIQUE constraint failed: matches.played_on, "
                    "matches.player1_id, matches.player2_id",
                )
            ),
            match_service.DailyMatchConflictError,
        ),
        (
            _integrity_error(PostgresIntegrityError("23503", "matches_player1_id_fkey")),
            match_service.PlayerNotFoundError,
        ),
        (
            _integrity_error(sqlite3.IntegrityError("FOREIGN KEY constraint failed")),
            match_service.PlayerNotFoundError,
        ),
    ],
)
def test_integrity_error_classifier_translates_only_supported_constraints(
    error: IntegrityError,
    expected_type: type[Exception],
) -> None:
    assert isinstance(match_service._classify_integrity_error(error), expected_type)


@pytest.mark.parametrize(
    "error",
    [
        _integrity_error(PostgresIntegrityError("23505", "uq_users_username")),
        _integrity_error(PostgresIntegrityError("23514", "allowed_score")),
        _integrity_error(sqlite3.IntegrityError("UNIQUE constraint failed: users.username")),
        _integrity_error(sqlite3.IntegrityError("CHECK constraint failed: allowed_score")),
    ],
)
def test_integrity_error_classifier_leaves_unrelated_constraints_untranslated(
    error: IntegrityError,
) -> None:
    assert match_service._classify_integrity_error(error) is None


def test_admin_username_conflict_classifier_is_narrow() -> None:
    assert _is_username_integrity_error(
        _integrity_error(PostgresIntegrityError("23505", "uq_users_username"))
    )
    assert not _is_username_integrity_error(
        _integrity_error(PostgresIntegrityError("23514", "player_profile_required"))
    )


def test_player_validation_locks_rows_in_deterministic_order() -> None:
    captured: dict[str, object] = {}

    class ScalarResult:
        @staticmethod
        def all() -> list[int]:
            return [2, 9]

    class CapturingSession:
        @staticmethod
        def scalars(statement: object) -> ScalarResult:
            captured["statement"] = statement
            return ScalarResult()

    match_service._ensure_players(
        cast(Session, CapturingSession()),
        {9, 2},
    )
    statement = captured["statement"]
    sql = str(statement.compile(dialect=postgresql.dialect()))  # type: ignore[attr-defined]
    assert "ORDER BY users.id" in sql
    assert sql.rstrip().endswith("FOR UPDATE")


def test_match_lookup_uses_select_for_update() -> None:
    captured: dict[str, object] = {}
    match = Match(
        id=7,
        player1_id=1,
        player2_id=2,
        score1=3,
        score2=0,
        kind=MatchKind.CASUAL,
        played_on=date(2026, 8, 13),
    )

    class CapturingSession:
        @staticmethod
        def scalar(statement: object) -> Match:
            captured["statement"] = statement
            return match

    assert match_service._get_match_for_update(cast(Session, CapturingSession()), 7) is match
    statement = captured["statement"]
    sql = str(statement.compile(dialect=postgresql.dialect()))  # type: ignore[attr-defined]
    assert "WHERE matches.id =" in sql
    assert sql.rstrip().endswith("FOR UPDATE")


def test_create_reraises_unrelated_integrity_error(monkeypatch: pytest.MonkeyPatch) -> None:
    error = _integrity_error(sqlite3.IntegrityError("CHECK constraint failed: allowed_score"))
    db = MagicMock(spec=Session)
    db.commit.side_effect = error
    monkeypatch.setattr(match_service, "_ensure_players", MagicMock())
    monkeypatch.setattr(match_service, "_ensure_pair_available", MagicMock())

    with pytest.raises(IntegrityError) as caught:
        match_service.create_player_match(
            db,
            submitter=User(id=1),
            opponent_id=2,
            my_score=3,
            opponent_score=0,
        )

    assert caught.value is error
    db.rollback.assert_called_once_with()


def test_update_translates_foreign_key_error(monkeypatch: pytest.MonkeyPatch) -> None:
    error = _integrity_error(sqlite3.IntegrityError("FOREIGN KEY constraint failed"))
    db = MagicMock(spec=Session)
    db.commit.side_effect = error
    match = Match(
        id=7,
        player1_id=1,
        player2_id=2,
        score1=3,
        score2=0,
        kind=MatchKind.CASUAL,
        played_on=date(2026, 8, 13),
    )
    locked_lookup = MagicMock(return_value=match)
    monkeypatch.setattr(match_service, "_get_match_for_update", locked_lookup)
    monkeypatch.setattr(match_service, "_ensure_pair_available", MagicMock())

    with pytest.raises(match_service.PlayerNotFoundError):
        match_service.update_match(
            db,
            match_id=match.id,
            changes={"score1": 0, "score2": 3},
        )

    locked_lookup.assert_called_once_with(db, match.id)
    db.rollback.assert_called_once_with()


def test_update_reraises_unrelated_integrity_error(monkeypatch: pytest.MonkeyPatch) -> None:
    error = _integrity_error(sqlite3.IntegrityError("CHECK constraint failed: allowed_score"))
    db = MagicMock(spec=Session)
    db.commit.side_effect = error
    match = Match(
        id=7,
        player1_id=1,
        player2_id=2,
        score1=3,
        score2=0,
        kind=MatchKind.CASUAL,
        played_on=date(2026, 8, 13),
    )
    monkeypatch.setattr(match_service, "_get_match_for_update", MagicMock(return_value=match))
    monkeypatch.setattr(match_service, "_ensure_pair_available", MagicMock())

    with pytest.raises(IntegrityError) as caught:
        match_service.update_match(
            db,
            match_id=match.id,
            changes={"score1": 0, "score2": 3},
        )

    assert caught.value is error
    db.rollback.assert_called_once_with()


@pytest.mark.parametrize("operation", ["update", "delete"])
def test_stale_admin_write_becomes_match_not_found(
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
) -> None:
    db = MagicMock(spec=Session)
    db.commit.side_effect = StaleDataError("concurrent delete")
    match = Match(
        id=7,
        player1_id=1,
        player2_id=2,
        score1=3,
        score2=0,
        kind=MatchKind.CASUAL,
        played_on=date(2026, 8, 13),
    )
    locked_lookup = MagicMock(return_value=match)
    monkeypatch.setattr(match_service, "_get_match_for_update", locked_lookup)
    monkeypatch.setattr(match_service, "_ensure_pair_available", MagicMock())

    with pytest.raises(match_service.MatchNotFoundError, match="no longer exists"):
        if operation == "update":
            match_service.update_match(
                db,
                match_id=match.id,
                changes={"score1": 0, "score2": 3},
            )
        else:
            match_service.delete_match(db, match_id=match.id)

    locked_lookup.assert_called_once_with(db, match.id)
    db.rollback.assert_called_once_with()
