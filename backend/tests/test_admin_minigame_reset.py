from __future__ import annotations

from datetime import UTC, date, datetime
from typing import cast

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.admin import _lock_minigame_for_reset
from app.models import (
    AuthSession,
    CoinFlipState,
    Match,
    MatchKind,
    PaddleFlightScore,
    User,
)
from app.schemas.admin import (
    COIN_FLIP_RESET_CONFIRMATION,
    PADDLE_FLIGHT_RESET_CONFIRMATION,
)


def _create_player(admin, username: str) -> dict:
    response = admin.post(
        "/api/v1/admin/players",
        json={
            "username": username,
            "password": "20260000",
            "gender": "M",
            "is_freshman": False,
            "club_rank": 4,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _setup(api):
    api.create_admin()
    admin = api.client()
    api.login(admin, "admin", "admin-password")
    player_a = _create_player(admin, "게임선수A")
    player_b = _create_player(admin, "게임선수B")
    player_a_client = api.client()
    player_b_client = api.client()
    api.login(player_a_client, "게임선수A", "20260000")
    api.login(player_b_client, "게임선수B", "20260000")

    now = datetime.now(UTC)
    with api.session_factory() as db:
        for index, player in enumerate((player_a, player_b), start=1):
            db.add(
                CoinFlipState(
                    user_id=player["id"],
                    active=False,
                    run_id=index,
                    current_streak=0,
                    best_streak=index + 1,
                    best_achieved_at=now,
                    last_flip_at=now,
                    daily_attempt_date=date(2026, 9, 4),
                    daily_attempts_used=index,
                )
            )
            db.add(
                PaddleFlightScore(
                    user_id=player["id"],
                    best_score=index * 10,
                    best_achieved_at=now,
                    last_submitted_at=now,
                )
            )
        db.add(
            Match(
                player1_id=player_a["id"],
                player2_id=player_b["id"],
                score1=3,
                score2=0,
                kind=MatchKind.CASUAL,
                played_on=date(2026, 9, 4),
                played_at=now,
            )
        )
        db.commit()

    return admin, player_a_client, player_b_client


def _record_count(db: Session, model: type[object]) -> int:
    return int(db.scalar(select(func.count()).select_from(model)) or 0)


def test_minigame_reset_preview_requires_admin_and_reports_each_game(api) -> None:
    admin, player, _ = _setup(api)
    anonymous = api.client()

    for game, confirmation in (
        ("coin-flip", COIN_FLIP_RESET_CONFIRMATION),
        ("paddle-flight", PADDLE_FLIGHT_RESET_CONFIRMATION),
    ):
        path = f"/api/v1/admin/minigames/{game}/reset-preview"
        assert anonymous.get(path).status_code == 401
        assert player.get(path).status_code == 403
        response = admin.get(path)
        assert response.status_code == 200, response.text
        assert response.json() == {
            "game": game,
            "record_count": 2,
            "confirmation_required": confirmation,
        }

    assert admin.get("/api/v1/admin/minigames/not-a-game/reset-preview").status_code == 422


def test_coin_flip_reset_requires_confirmation_and_password_then_preserves_other_data(
    api,
) -> None:
    admin, player_a, player_b = _setup(api)
    path = "/api/v1/admin/minigames/coin-flip/reset"
    payload = {
        "confirmation": COIN_FLIP_RESET_CONFIRMATION,
        "admin_password": "admin-password",
    }

    assert api.client().post(path, json=payload).status_code == 401
    assert player_a.post(path, json=payload).status_code == 403

    wrong_phrase = admin.post(
        path,
        json={**payload, "confirmation": "기록을 삭제합니다"},
    )
    assert wrong_phrase.status_code == 400
    assert wrong_phrase.json()["detail"] == "확인 문구가 일치하지 않습니다."

    wrong_password = admin.post(
        path,
        json={**payload, "admin_password": "wrong-password"},
    )
    assert wrong_password.status_code == 403
    assert wrong_password.json()["detail"] == "관리자 비밀번호가 올바르지 않습니다."

    with api.session_factory() as db:
        assert _record_count(db, CoinFlipState) == 2
        assert _record_count(db, PaddleFlightScore) == 2

    response = admin.post(path, json=payload)
    assert response.status_code == 200, response.text
    assert response.json() == {
        "game": "coin-flip",
        "deleted_records": 2,
        "message": "동전 던지기 기록을 초기화했습니다.",
    }
    assert admin.get("/api/v1/admin/minigames/coin-flip/reset-preview").json()[
        "record_count"
    ] == 0

    with api.session_factory() as db:
        assert _record_count(db, CoinFlipState) == 0
        assert _record_count(db, PaddleFlightScore) == 2
        assert _record_count(db, Match) == 1
        assert _record_count(db, User) == 3
        assert _record_count(db, AuthSession) == 3

    assert player_a.get("/api/v1/auth/me").status_code == 200
    assert player_b.get("/api/v1/auth/me").status_code == 200
    assert player_a.get("/api/v1/minigames/coin-flip").json()["ranking"] == []
    assert len(player_a.get("/api/v1/minigames/paddle-flight").json()["ranking"]) == 2

    repeated = admin.post(path, json=payload)
    assert repeated.status_code == 200
    assert repeated.json()["deleted_records"] == 0


def test_paddle_flight_reset_deletes_only_paddle_records(api) -> None:
    admin, player_a, _ = _setup(api)
    path = "/api/v1/admin/minigames/paddle-flight/reset"

    response = admin.post(
        path,
        json={
            "confirmation": PADDLE_FLIGHT_RESET_CONFIRMATION,
            "admin_password": "admin-password",
        },
    )
    assert response.status_code == 200, response.text
    assert response.json() == {
        "game": "paddle-flight",
        "deleted_records": 2,
        "message": "탁구공 날리기 기록을 초기화했습니다.",
    }

    with api.session_factory() as db:
        assert _record_count(db, PaddleFlightScore) == 0
        assert _record_count(db, CoinFlipState) == 2
        assert _record_count(db, Match) == 1
        assert _record_count(db, User) == 3
        assert _record_count(db, AuthSession) == 3

    paddle_overview = player_a.get("/api/v1/minigames/paddle-flight")
    assert paddle_overview.status_code == 200
    assert paddle_overview.json() == {"best_score": 0, "ranking": []}
    assert len(player_a.get("/api/v1/minigames/coin-flip").json()["ranking"]) == 2


class _FakeDialect:
    def __init__(self, name: str) -> None:
        self.name = name


class _FakeBind:
    def __init__(self, dialect_name: str) -> None:
        self.dialect = _FakeDialect(dialect_name)


class _LockRecordingSession:
    def __init__(self, dialect_name: str) -> None:
        self.bind = _FakeBind(dialect_name)
        self.statements: list[str] = []

    def get_bind(self):
        return self.bind

    def execute(self, statement):
        self.statements.append(str(statement))


def test_minigame_reset_uses_game_specific_exclusive_postgresql_locks() -> None:
    postgres = _LockRecordingSession("postgresql")
    db = cast(Session, postgres)

    _lock_minigame_for_reset(db, table_name="coin_flip_states")
    _lock_minigame_for_reset(db, table_name="paddle_flight_scores")

    assert postgres.statements == [
        "LOCK TABLE coin_flip_states IN ACCESS EXCLUSIVE MODE",
        "LOCK TABLE paddle_flight_scores IN ACCESS EXCLUSIVE MODE",
    ]

    sqlite = _LockRecordingSession("sqlite")
    _lock_minigame_for_reset(cast(Session, sqlite), table_name="coin_flip_states")
    assert sqlite.statements == []
