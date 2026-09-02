from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from threading import Barrier

from sqlalchemy import create_engine, event, func, select
from sqlalchemy.orm import sessionmaker

from app.core.database import Base
from app.core.security import hash_password
from app.models import CoinFlipState, Gender, User, UserRole
from app.schemas.minigames import CoinSide
from app.services.minigames import CoinFlipRoundConflictError, flip_coin, start_coin_flip


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


def _setup_player(api, username: str = "동전선수"):
    api.create_admin()
    admin = api.client()
    api.login(admin, "admin", "admin-password")
    player = _create_player(admin, username)
    client = api.client()
    api.login(client, username, "20260000")
    return admin, player, client


def test_coin_flip_is_player_only_and_persists_game_state(api, monkeypatch) -> None:
    admin, player, client = _setup_player(api)
    path = "/api/v1/minigames/coin-flip"

    assert api.client().get(path).status_code == 401
    assert admin.get(path).status_code == 403
    assert admin.post(f"{path}/start").status_code == 403
    assert (
        admin.post(
            f"{path}/flip",
            json={"choice": "heads", "run_id": 1, "round_no": 1},
        ).status_code
        == 403
    )

    initial = client.get(path)
    assert initial.status_code == 200
    assert initial.json() == {
        "state": {
            "active": False,
            "run_id": 0,
            "current_streak": 0,
            "best_streak": 0,
            "remaining_attempts": 20,
        },
        "ranking": [],
    }
    assert (
        client.post(
            f"{path}/flip",
            json={"choice": "heads", "run_id": 1, "round_no": 1},
        ).status_code
        == 409
    )

    started = client.post(f"{path}/start")
    assert started.status_code == 200, started.text
    assert started.json()["state"] == {
        "active": True,
        "run_id": 1,
        "current_streak": 0,
        "best_streak": 0,
        "remaining_attempts": 19,
    }
    assert started.json()["ranking"] == [
        {
            "rank": 1,
            "user_id": player["id"],
            "username": player["username"],
            "best_streak": 0,
        }
    ]

    # Starting an already active run resumes it instead of erasing its state.
    assert client.post(f"{path}/start").json()["state"]["run_id"] == 1

    monkeypatch.setattr("app.services.minigames.secrets.randbits", lambda _: 0)
    won = client.post(
        f"{path}/flip",
        json={"choice": "heads", "run_id": 1, "round_no": 1},
    )
    assert won.status_code == 200, won.text
    assert won.json() == {
        "result": "heads",
        "correct": True,
        "game_over": False,
        "final_score": None,
        "state": {
            "active": True,
            "run_id": 1,
            "current_streak": 1,
            "best_streak": 1,
            "remaining_attempts": 19,
        },
        "ranking": [
            {
                "rank": 1,
                "user_id": player["id"],
                "username": player["username"],
                "best_streak": 1,
            }
        ],
    }

    # A refresh sees the same active run and streak.
    assert client.get(path).json() == {
        "state": won.json()["state"],
        "ranking": won.json()["ranking"],
    }

    # The same round cannot be consumed twice, including a simultaneous double click.
    duplicate = client.post(
        f"{path}/flip",
        json={"choice": "heads", "run_id": 1, "round_no": 1},
    )
    assert duplicate.status_code == 409
    assert client.get(path).json()["state"]["current_streak"] == 1

    too_fast = client.post(
        f"{path}/flip",
        json={"choice": "heads", "run_id": 1, "round_no": 2},
    )
    assert too_fast.status_code == 429
    assert too_fast.headers["Retry-After"] == "1"
    with api.session_factory() as db:
        state = db.get(CoinFlipState, player["id"])
        assert state is not None
        state.last_flip_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()

    lost = client.post(
        f"{path}/flip",
        json={"choice": "tails", "run_id": 1, "round_no": 2},
    )
    assert lost.status_code == 200, lost.text
    assert lost.json()["result"] == "heads"
    assert lost.json()["correct"] is False
    assert lost.json()["game_over"] is True
    assert lost.json()["final_score"] == 1
    assert lost.json()["state"] == {
        "active": False,
        "run_id": 1,
        "current_streak": 0,
        "best_streak": 1,
        "remaining_attempts": 19,
    }

    restarted = client.post(f"{path}/start")
    assert restarted.status_code == 200
    assert restarted.json()["state"]["run_id"] == 2
    assert restarted.json()["state"]["remaining_attempts"] == 18

    # A delayed retry from the previous run cannot consume run 2 round 1.
    stale = client.post(
        f"{path}/flip",
        json={"choice": "heads", "run_id": 1, "round_no": 1},
    )
    assert stale.status_code == 409
    assert client.get(path).json()["state"] == {
        "active": True,
        "run_id": 2,
        "current_streak": 0,
        "best_streak": 1,
        "remaining_attempts": 18,
    }

    # Restarting does not bypass the per-player interval from the previous run.
    after_restart = client.post(
        f"{path}/flip",
        json={"choice": "heads", "run_id": 2, "round_no": 1},
    )
    assert after_restart.status_code == 429
    with api.session_factory() as db:
        state = db.get(CoinFlipState, player["id"])
        assert state is not None
        state.last_flip_at = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()
    accepted = client.post(
        f"{path}/flip",
        json={"choice": "heads", "run_id": 2, "round_no": 1},
    )
    assert accepted.status_code == 200
    assert accepted.json()["state"]["current_streak"] == 1


def test_coin_flip_allows_twenty_new_runs_per_korea_day(api, monkeypatch) -> None:
    _, player, client = _setup_player(api, "일일시도선수")
    path = "/api/v1/minigames/coin-flip"
    just_before_midnight = datetime(2026, 9, 2, 14, 59, tzinfo=UTC)
    monkeypatch.setattr(
        "app.services.minigames.utc_now", lambda: just_before_midnight
    )

    for attempt in range(1, 21):
        started = client.post(f"{path}/start")
        assert started.status_code == 200, started.text
        assert started.json()["state"]["remaining_attempts"] == 20 - attempt

        # Reopening the current game resumes it and never spends another attempt.
        resumed = client.post(f"{path}/start")
        assert resumed.status_code == 200, resumed.text
        assert resumed.json()["state"]["remaining_attempts"] == 20 - attempt

        with api.session_factory() as db:
            state = db.get(CoinFlipState, player["id"])
            assert state is not None
            state.active = False
            state.current_streak = 0
            db.commit()

    exhausted = client.post(f"{path}/start")
    assert exhausted.status_code == 429
    assert exhausted.json()["detail"] == "오늘의 동전 던지기 시도 20회를 모두 사용했습니다."
    assert exhausted.headers["Retry-After"] == "60"
    assert client.get(path).json()["state"]["remaining_attempts"] == 0

    # The quota resets at midnight in Korea, regardless of the server time zone.
    next_korea_day = just_before_midnight + timedelta(minutes=1)
    monkeypatch.setattr("app.services.minigames.utc_now", lambda: next_korea_day)
    assert client.get(path).json()["state"]["remaining_attempts"] == 20
    next_day = client.post(f"{path}/start")
    assert next_day.status_code == 200, next_day.text
    assert next_day.json()["state"]["remaining_attempts"] == 19
    assert next_day.json()["state"]["run_id"] == 21


def test_coin_flip_ranking_uses_dense_rank_and_first_achievement_order(api) -> None:
    api.create_admin()
    admin = api.client()
    api.login(admin, "admin", "admin-password")
    late = _create_player(admin, "가나다")
    early = _create_player(admin, "하늘")
    lower = _create_player(admin, "중간")
    excluded = _create_player(admin, "미참여")

    clients = []
    for username in (late["username"], early["username"], lower["username"]):
        client = api.client()
        api.login(client, username, "20260000")
        assert client.post("/api/v1/minigames/coin-flip/start").status_code == 200
        clients.append(client)

    base = datetime(2026, 8, 25, 1, 0, tzinfo=UTC)
    with api.session_factory() as db:
        states = {
            state.user_id: state
            for state in db.scalars(
                select(CoinFlipState).where(
                    CoinFlipState.user_id.in_([late["id"], early["id"], lower["id"]])
                )
            )
        }
        states[late["id"]].best_streak = 3
        states[late["id"]].best_achieved_at = base + timedelta(minutes=1)
        states[early["id"]].best_streak = 3
        states[early["id"]].best_achieved_at = base
        states[lower["id"]].best_streak = 1
        states[lower["id"]].best_achieved_at = base
        db.commit()

    ranking = clients[0].get("/api/v1/minigames/coin-flip").json()["ranking"]
    assert [
        (entry["username"], entry["rank"], entry["best_streak"]) for entry in ranking
    ] == [
        (early["username"], 1, 3),
        (late["username"], 1, 3),
        (lower["username"], 2, 1),
    ]
    assert excluded["username"] not in {entry["username"] for entry in ranking}


def test_coin_flip_state_cascades_on_player_delete_and_database_reset(api) -> None:
    admin, player, client = _setup_player(api)
    assert client.post("/api/v1/minigames/coin-flip/start").status_code == 200

    deleted = admin.delete(f"/api/v1/admin/players/{player['id']}")
    assert deleted.status_code == 204, deleted.text
    with api.session_factory() as db:
        assert db.get(CoinFlipState, player["id"]) is None

    reset_player = _create_player(admin, "초기화선수")
    reset_client = api.client()
    api.login(reset_client, reset_player["username"], "20260000")
    assert reset_client.post("/api/v1/minigames/coin-flip/start").status_code == 200

    reset = admin.post(
        "/api/v1/admin/database/reset",
        json={
            "confirmation": "모든 경기, 대회와 선수 데이터를 삭제합니다",
            "admin_password": "admin-password",
        },
    )
    assert reset.status_code == 200, reset.text
    with api.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(CoinFlipState)) == 0


def test_coin_flip_contract_rejects_unknown_or_invalid_fields(api) -> None:
    _, _, client = _setup_player(api)
    assert client.post("/api/v1/minigames/coin-flip/start").status_code == 200
    path = "/api/v1/minigames/coin-flip/flip"

    assert client.post(path, json={"choice": "edge", "run_id": 1, "round_no": 1}).status_code == 422
    invalid_run = client.post(
        path, json={"choice": "heads", "run_id": 0, "round_no": 1}
    )
    assert invalid_run.status_code == 422
    invalid_round = client.post(
        path, json={"choice": "heads", "run_id": 1, "round_no": 0}
    )
    assert invalid_round.status_code == 422
    assert (
        client.post(
            path,
            json={"choice": "heads", "run_id": 1, "round_no": 1, "result": "heads"},
        ).status_code
        == 422
    )


def test_same_round_concurrent_flips_are_consumed_once(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "concurrent-coin.db"
    engine = create_engine(
        f"sqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection: object, _: object) -> None:
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as db:
        player = User(
            username="동시선수",
            password_hash=hash_password("20260000"),
            role=UserRole.PLAYER,
            gender=Gender.MALE,
            is_freshman=False,
            club_rank=4,
        )
        db.add(player)
        db.flush()
        player_id = player.id
        db.add(
            CoinFlipState(
                user_id=player_id,
                active=True,
                run_id=1,
                current_streak=0,
                best_streak=0,
            )
        )
        db.commit()

    monkeypatch.setattr("app.services.minigames.secrets.randbits", lambda _: 0)
    barrier = Barrier(2)

    def submit() -> str:
        with factory() as db:
            barrier.wait()
            try:
                outcome = flip_coin(
                    db,
                    user_id=player_id,
                    choice=CoinSide.HEADS,
                    run_id=1,
                    round_no=1,
                )
            except CoinFlipRoundConflictError:
                return "conflict"
            return f"won:{outcome.state.current_streak}"

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: submit(), range(2)))

        assert sorted(results) == ["conflict", "won:1"]
        with factory() as db:
            state = db.get(CoinFlipState, player_id)
            assert state is not None
            assert state.current_streak == 1
            assert state.best_streak == 1
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


def test_concurrent_new_run_starts_spend_one_daily_attempt(tmp_path, monkeypatch) -> None:
    database_path = tmp_path / "concurrent-coin-start.db"
    engine = create_engine(
        f"sqlite:///{database_path.as_posix()}",
        connect_args={"check_same_thread": False, "timeout": 10},
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection: object, _: object) -> None:
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as db:
        player = User(
            username="동시시작선수",
            password_hash=hash_password("20260000"),
            role=UserRole.PLAYER,
            gender=Gender.MALE,
            is_freshman=False,
            club_rank=4,
        )
        db.add(player)
        db.flush()
        player_id = player.id
        db.add(
            CoinFlipState(
                user_id=player_id,
                active=False,
                run_id=1,
                current_streak=0,
                best_streak=0,
            )
        )
        db.commit()

    fixed_now = datetime(2026, 9, 2, 3, 0, tzinfo=UTC)
    monkeypatch.setattr("app.services.minigames.utc_now", lambda: fixed_now)
    barrier = Barrier(2)

    def start() -> tuple[int, int]:
        with factory() as db:
            barrier.wait()
            state = start_coin_flip(db, user_id=player_id)
            return state.run_id, state.daily_attempts_used

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(lambda _: start(), range(2)))

        assert results == [(2, 1), (2, 1)]
        with factory() as db:
            state = db.get(CoinFlipState, player_id)
            assert state is not None
            assert state.active is True
            assert state.run_id == 2
            assert state.daily_attempts_used == 1
            assert state.daily_attempt_date.isoformat() == "2026-09-02"
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()
