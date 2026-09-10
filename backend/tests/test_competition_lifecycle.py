from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import text

from app.models import Competition


@dataclass
class LifecycleClock:
    now: datetime


@pytest.fixture
def lifecycle_clock(monkeypatch) -> LifecycleClock:
    clock = LifecycleClock(datetime(2026, 9, 11, 8, 0, tzinfo=UTC))
    monkeypatch.setattr("app.services.competitions.utc_now", lambda: clock.now)
    monkeypatch.setattr(
        "app.services.matches.seoul_now", lambda: clock.now.astimezone(ZoneInfo("Asia/Seoul"))
    )
    return clock


def _setup(api, count: int):
    api.create_admin()
    admin = api.client()
    api.login(admin, "admin", "admin-password")
    players = []
    for index in range(count):
        response = admin.post(
            "/api/v1/admin/players",
            json={
                "username": f"상태선수{index + 1}",
                "password": "20260000",
                "gender": "M",
                "club_rank": 3,
            },
        )
        assert response.status_code == 201, response.text
        players.append(response.json())
    return admin, players


def _login(api, player):
    client = api.client()
    api.login(client, player["username"], "20260000")
    return client


def _league(admin, players):
    response = admin.post(
        "/api/v1/admin/competitions",
        json={
            "name": "완료 상태 리그",
            "type": "league",
            "participant_ids": [player["id"] for player in players],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _team(admin, players):
    response = admin.post(
        "/api/v1/admin/competitions",
        json={
            "name": "완료 상태 단체전",
            "type": "team",
            "teams": [
                {"name": "A", "member_ids": [player["id"] for player in players[:4]]},
                {"name": "B", "member_ids": [player["id"] for player in players[4:]]},
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _utc(value: str | datetime) -> datetime:
    instant = datetime.fromisoformat(value) if isinstance(value, str) else value
    return instant.replace(tzinfo=UTC) if instant.tzinfo is None else instant.astimezone(UTC)


def _stored_state(api, competition_id, status, completed_at=None):
    with api.session_factory() as db:
        competition = db.get(Competition, competition_id)
        assert competition is not None
        assert competition.status.value == status
        if completed_at is None:
            assert competition.completed_at is None
        else:
            assert _utc(competition.completed_at) == completed_at


def _detail(admin, competition_id):
    response = admin.get(f"/api/v1/admin/competitions/{competition_id}")
    assert response.status_code == 200, response.text
    return response.json()


def _league_result(admin, competition_id, fixture, *, score1=3, score2=0):
    response = admin.put(
        f"/api/v1/admin/competitions/{competition_id}/league-fixtures/{fixture['id']}/result",
        json={"score1": score1, "score2": score2, "played_on": "2026-08-01"},
    )
    assert response.status_code == 200, response.text
    return response.json()


def _finish_league(admin, competition):
    for fixture in competition["fixtures"]:
        _league_result(admin, competition["id"], fixture)


def _single_result(admin, competition, index, *, team1_wins):
    encounter = competition["encounters"][0]
    response = admin.post(
        f"/api/v1/admin/competitions/{competition['id']}/team-encounters/{encounter['id']}/singles",
        json={
            "team1_player_id": encounter["team1"]["members"][index]["id"],
            "team2_player_id": encounter["team2"]["members"][index]["id"],
            "score1": 3 if team1_wins else 0,
            "score2": 0 if team1_wins else 3,
            "played_on": "2026-08-01",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


@pytest.mark.parametrize("final_writer", ["admin", "player"])
def test_last_league_result_completes_at_input_time(api, lifecycle_clock, final_writer):
    admin, players = _setup(api, 4)
    competition = _league(admin, players)
    cid = competition["id"]
    for fixture in competition["fixtures"][:-1]:
        _league_result(admin, cid, fixture)
    _stored_state(api, cid, "active")

    lifecycle_clock.now += timedelta(hours=2, seconds=17)
    finished_at = lifecycle_clock.now
    final_fixture = competition["fixtures"][-1]
    if final_writer == "admin":
        _league_result(admin, cid, final_fixture)
    else:
        player = _login(api, final_fixture["player2"])
        response = player.post(
            f"/api/v1/competitions/{cid}/league-fixtures/{final_fixture['id']}/result",
            json={"my_score": 2, "opponent_score": 1},
        )
        assert response.status_code == 200, response.text

    # Check before a detail/list GET: the final mutation must persist completion.
    _stored_state(api, cid, "completed", finished_at)
    detail = _detail(admin, cid)
    assert detail["completed_count"] == detail["total_count"] == 6
    assert detail["status"] == "completed"
    assert _utc(detail["completed_at"]) == finished_at
    assert all(not fixture["can_submit"] for fixture in detail["fixtures"])


def test_team_three_wins_still_requires_four_singles(api, lifecycle_clock):
    admin, players = _setup(api, 8)
    competition = _team(admin, players)
    cid = competition["id"]
    for index in range(3):
        _single_result(admin, competition, index, team1_wins=True)
    _stored_state(api, cid, "active")
    pending = _detail(admin, cid)
    assert pending["completed_count"] == 0
    assert not pending["encounters"][0]["completed"]
    assert admin.post(f"/api/v1/admin/competitions/{cid}/complete").status_code == 409

    lifecycle_clock.now += timedelta(minutes=7)
    final = _single_result(admin, competition, 3, team1_wins=False)
    assert final["completed"]
    assert final["doubles"] is None
    _stored_state(api, cid, "completed", lifecycle_clock.now)


def test_team_doubles_required_and_changed_losers_reset_completion(api, lifecycle_clock):
    admin, players = _setup(api, 8)
    competition = _team(admin, players)
    cid = competition["id"]
    encounter_id = competition["encounters"][0]["id"]
    for index in range(4):
        encounter = _single_result(admin, competition, index, team1_wins=index < 2)
    _stored_state(api, cid, "active")
    assert not encounter["completed"]
    assert encounter["doubles"] and not encounter["doubles"]["completed"]
    assert admin.post(f"/api/v1/admin/competitions/{cid}/complete").status_code == 409

    lifecycle_clock.now += timedelta(minutes=5)
    first_completion = lifecycle_clock.now
    actor = _login(api, players[0])
    response = actor.post(
        f"/api/v1/competitions/{cid}/team-encounters/{encounter_id}/doubles",
        json={"my_team_score": 2, "opponent_team_score": 1},
    )
    assert response.status_code == 200, response.text
    _stored_state(api, cid, "completed", first_completion)

    def correct_single(index, score1, score2):
        single = encounter["singles"][index]
        result = admin.put(
            f"/api/v1/admin/competitions/{cid}/team-singles/{single['id']}",
            json={
                "team1_player_id": single["team1_player"]["id"],
                "team2_player_id": single["team2_player"]["id"],
                "score1": score1,
                "score2": score2,
            },
        )
        assert result.status_code == 200, result.text
        return result.json()

    lifecycle_clock.now += timedelta(minutes=3)
    no_doubles_needed = correct_single(0, 0, 3)
    assert no_doubles_needed["completed"] and no_doubles_needed["doubles"] is None
    _stored_state(api, cid, "completed", first_completion)

    changed_losers = correct_single(2, 3, 0)
    assert not changed_losers["completed"]
    assert changed_losers["doubles"] and not changed_losers["doubles"]["completed"]
    _stored_state(api, cid, "active")
    lifecycle_clock.now += timedelta(minutes=4)
    doubles_path = f"/api/v1/admin/competitions/{cid}/team-encounters/{encounter_id}/doubles"
    response = admin.put(doubles_path, json={"score1": 3, "score2": 0})
    assert response.status_code == 200, response.text
    _stored_state(api, cid, "completed", lifecycle_clock.now)
    assert lifecycle_clock.now > first_completion

    response = admin.delete(doubles_path)
    assert response.status_code == 204, response.text
    _stored_state(api, cid, "active")
    lifecycle_clock.now += timedelta(minutes=1)
    response = admin.put(doubles_path, json={"score1": 0, "score2": 3})
    assert response.status_code == 200, response.text
    _stored_state(api, cid, "completed", lifecycle_clock.now)

    response = admin.delete(
        f"/api/v1/admin/competitions/{cid}/team-singles/{encounter['singles'][0]['id']}"
    )
    assert response.status_code == 204, response.text
    _stored_state(api, cid, "active")


def test_correction_manual_close_and_recompletion_keep_meaningful_timestamps(api, lifecycle_clock):
    admin, players = _setup(api, 4)
    competition = _league(admin, players)
    cid = competition["id"]
    _finish_league(admin, competition)
    first_completion = lifecycle_clock.now
    _stored_state(api, cid, "completed", first_completion)

    lifecycle_clock.now += timedelta(hours=1)
    fixture = competition["fixtures"][0]
    _league_result(admin, cid, fixture, score1=0, score2=3)
    _stored_state(api, cid, "completed", first_completion)
    response = admin.patch(f"/api/v1/admin/competitions/{cid}", json={"name": "이름만 수정"})
    assert response.status_code == 200, response.text
    _stored_state(api, cid, "completed", first_completion)

    closed = admin.post(f"/api/v1/admin/competitions/{cid}/complete")
    assert closed.status_code == 200, closed.text
    assert closed.json()["status"] == "closed"
    _stored_state(api, cid, "closed", first_completion)
    assert admin.post(f"/api/v1/admin/competitions/{cid}/complete").status_code == 200
    _stored_state(api, cid, "closed", first_completion)
    _league_result(admin, cid, fixture)
    _stored_state(api, cid, "closed", first_completion)

    path = f"/api/v1/admin/competitions/{cid}/league-fixtures/{fixture['id']}/result"
    response = admin.delete(path)
    assert response.status_code == 204, response.text
    _stored_state(api, cid, "active")
    lifecycle_clock.now += timedelta(minutes=20)
    _league_result(admin, cid, fixture)
    _stored_state(api, cid, "completed", lifecycle_clock.now)
    assert lifecycle_clock.now > first_completion


@pytest.mark.parametrize("first_read", ["filtered_list", "player_detail"])
def test_completed_closes_exactly_at_korea_midnight_and_filters_agree(
    api, lifecycle_clock, first_read
):
    admin, players = _setup(api, 4)
    competition = _league(admin, players)
    cid = competition["id"]
    still_active = _league(admin, players)
    actor = _login(api, players[0])
    lifecycle_clock.now = datetime(2026, 9, 11, 14, 59, 58, tzinfo=UTC)
    _finish_league(admin, competition)
    completed_at = lifecycle_clock.now
    # SQLite stores this UTC instant without tzinfo; do not interpret it as KST.
    with api.session_factory() as db:
        assert db.get(Competition, cid).completed_at == completed_at.replace(tzinfo=None)

    lifecycle_clock.now = datetime(2026, 9, 11, 14, 59, 59, 999999, tzinfo=UTC)
    before_midnight = admin.get("/api/v1/admin/competitions?status=completed")
    assert before_midnight.status_code == 200, before_midnight.text
    assert [item["id"] for item in before_midnight.json()] == [cid]
    assert _detail(admin, cid)["status"] == "completed"

    lifecycle_clock.now = datetime(2026, 9, 11, 15, 0, tzinfo=UTC)
    if first_read == "filtered_list":
        response = admin.get("/api/v1/admin/competitions?status=completed")
        assert response.status_code == 200, response.text
        assert response.json() == []
    else:
        response = actor.get(f"/api/v1/competitions/{cid}")
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "closed"

    for client, prefix in [(admin, "/admin/competitions"), (actor, "/competitions")]:
        expected_ids = {"active": [still_active["id"]], "completed": [], "closed": [cid]}
        for status, ids in expected_ids.items():
            response = client.get(f"/api/v1{prefix}?status={status}&type=league")
            assert response.status_code == 200, response.text
            assert [item["id"] for item in response.json()] == ids
            assert all(item["status"] == status for item in response.json())
        response = client.get(f"/api/v1{prefix}/{cid}")
        assert response.status_code == 200, response.text
        assert response.json()["status"] == "closed"
        assert _utc(response.json()["completed_at"]) == completed_at
    # Effective midnight closure is computed on reads without writing the database.
    _stored_state(api, cid, "completed", completed_at)


def test_sqlite_second_precision_completion_at_korea_midnight_keeps_filters_consistent(
    api, lifecycle_clock
):
    admin, players = _setup(api, 4)
    competition = _league(admin, players)
    cid = competition["id"]
    actor = _login(api, players[0])
    completed_at = datetime(2026, 9, 11, 15, 0, tzinfo=UTC)
    lifecycle_clock.now = completed_at
    _finish_league(admin, competition)

    # Reproduce SQLite CURRENT_TIMESTAMP storage without SQLAlchemy's .000000 suffix.
    with api.session_factory() as db:
        db.execute(
            text("UPDATE competitions SET completed_at = :stamp WHERE id = :id"),
            {"stamp": "2026-09-11 15:00:00", "id": cid},
        )
        db.commit()
        assert (
            db.scalar(text("SELECT completed_at FROM competitions WHERE id = :id"), {"id": cid})
            == "2026-09-11 15:00:00"
        )

    for elapsed, expected_status in [
        (timedelta(), "completed"),
        (timedelta(days=1, microseconds=-1), "completed"),
        (timedelta(days=1), "closed"),
    ]:
        lifecycle_clock.now = completed_at + elapsed
        for client, prefix in [(admin, "/admin/competitions"), (actor, "/competitions")]:
            for status in ["completed", "closed"]:
                response = client.get(f"/api/v1{prefix}?status={status}")
                assert response.status_code == 200, response.text
                expected_ids = [cid] if status == expected_status else []
                assert [item["id"] for item in response.json()] == expected_ids
                assert all(item["status"] == status for item in response.json())
            response = client.get(f"/api/v1{prefix}/{cid}")
            assert response.status_code == 200, response.text
            assert response.json()["status"] == expected_status
            assert _utc(response.json()["completed_at"]) == completed_at
    _stored_state(api, cid, "completed", completed_at)


def test_delayed_reentry_closes_without_replacing_original_completion_time(api, lifecycle_clock):
    admin, players = _setup(api, 4)
    competition = _league(admin, players)
    cid = competition["id"]
    _finish_league(admin, competition)
    completed_at = lifecycle_clock.now
    lifecycle_clock.now += timedelta(days=3, hours=4)
    actor = _login(api, players[0])
    response = actor.get("/api/v1/competitions?status=closed")
    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()] == [cid]
    assert _utc(response.json()[0]["completed_at"]) == completed_at
    _stored_state(api, cid, "completed", completed_at)


def test_competition_lists_sort_by_creation_time_without_status_priority(api, lifecycle_clock):
    admin, players = _setup(api, 4)
    actor = _login(api, players[0])
    specifications = [
        ("active", 3),
        ("completed", 4),
        ("closed", 4),
        ("active", 5),
        ("completed", 2),
        ("closed", 1),
    ]
    ids = []
    for status, created_hour in specifications:
        competition = _league(admin, players)
        cid = competition["id"]
        ids.append(cid)
        if status != "active":
            played_on = (lifecycle_clock.now - timedelta(days=len(ids))).date().isoformat()
            for fixture in competition["fixtures"]:
                response = admin.put(
                    f"/api/v1/admin/competitions/{cid}/league-fixtures/{fixture['id']}/result",
                    json={"score1": 3, "score2": 0, "played_on": played_on},
                )
                assert response.status_code == 200, response.text
        if status == "closed":
            response = admin.post(f"/api/v1/admin/competitions/{cid}/complete")
            assert response.status_code == 200, response.text
        with api.session_factory() as db:
            db.get(Competition, cid).created_at = lifecycle_clock.now.replace(hour=created_hour)
            db.commit()

    # The two 04:00 competitions must use descending ID even across status boundaries.
    expected_all = [ids[3], ids[2], ids[1], ids[0], ids[4], ids[5]]
    expected_filtered = {
        "active": [ids[3], ids[0]],
        "completed": [ids[1], ids[4]],
        "closed": [ids[2], ids[5]],
    }
    for client, prefix in [(admin, "/admin/competitions"), (actor, "/competitions")]:
        response = client.get(f"/api/v1{prefix}")
        assert response.status_code == 200, response.text
        assert [item["id"] for item in response.json()] == expected_all
        for status, expected_ids in expected_filtered.items():
            response = client.get(f"/api/v1{prefix}?status={status}")
            assert response.status_code == 200, response.text
            assert [item["id"] for item in response.json()] == expected_ids
            assert all(item["status"] == status for item in response.json())
