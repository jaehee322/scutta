from __future__ import annotations

from copy import deepcopy

import pytest
from sqlalchemy import select

from app.models import Competition, TeamDoublesGame

STALE_MESSAGE = "복식 출전자가 변경되었습니다. 대진을 새로 불러와 다시 입력해 주세요."


def _pending_doubles(api):
    api.create_admin()
    admin = api.client()
    api.login(admin, "admin", "admin-password")
    players = []
    for index in range(8):
        response = admin.post(
            "/api/v1/admin/players",
            json={
                "username": f"snapshot-player-{index}",
                "password": "player-password",
                "gender": "M",
                "club_rank": 3,
            },
        )
        assert response.status_code == 201, response.text
        players.append(response.json())
    response = admin.post(
        "/api/v1/admin/competitions",
        json={
            "name": "복식 출전자 확인",
            "type": "team",
            "teams": [
                {"name": "A", "member_ids": [p["id"] for p in players[:4]]},
                {"name": "B", "member_ids": [p["id"] for p in players[4:]]},
            ],
        },
    )
    assert response.status_code == 201, response.text
    competition = response.json()
    encounter = competition["encounters"][0]
    for index in range(4):
        response = admin.post(
            f"/api/v1/admin/competitions/{competition['id']}"
            f"/team-encounters/{encounter['id']}/singles",
            json={
                "team1_player_id": encounter["team1"]["members"][index]["id"],
                "team2_player_id": encounter["team2"]["members"][index]["id"],
                "score1": 3 if index < 2 else 0,
                "score2": 0 if index < 2 else 3,
            },
        )
        assert response.status_code == 200, response.text
    player = api.client()
    # Team 2 can submit for its team; the snapshot always keeps team1/team2 order.
    api.login(player, encounter["team2"]["members"][0]["username"], "player-password")
    return admin, player, competition["id"], response.json()


def _snapshot(double):
    return {
        "id": double["id"],
        "team1_player_ids": [p["id"] for p in double["team1_players"]],
        "team2_player_ids": [p["id"] for p in double["team2_players"]],
    }


def _save(admin, player, competition_id, encounter_id, role, snapshot):
    body = (
        {"score1": 2, "score2": 1}
        if role == "admin"
        else {
            "my_team_score": 2,
            "opponent_team_score": 1,
        }
    )
    if snapshot is not None:
        body["expected_doubles"] = snapshot
    prefix = "/admin/competitions" if role == "admin" else "/competitions"
    path = f"/api/v1{prefix}/{competition_id}/team-encounters/{encounter_id}/doubles"
    return admin.put(path, json=body) if role == "admin" else player.post(path, json=body)


def _stored_result(api, competition_id):
    with api.session_factory() as db:
        competition = db.get(Competition, competition_id)
        double = db.scalar(select(TeamDoublesGame))
        return {
            "competition": (
                competition.status,
                competition.completed_at,
                competition.updated_at,
            ),
            "doubles": (
                tuple(getattr(double, column.name) for column in double.__table__.columns)
                if double is not None
                else None
            ),
        }


@pytest.mark.parametrize("role", ["admin", "player"])
def test_stale_doubles_lineup_is_rejected_even_when_sqlite_reuses_id(api, role):
    admin, player, competition_id, encounter = _pending_doubles(api)
    old_snapshot = _snapshot(encounter["doubles"])
    # A user leaves the old form open while two singles are corrected. The
    # temporary 3:1 removes doubles; restoring 2:2 creates different participants.
    for index in (0, 2):
        single = encounter["singles"][index]
        corrected = admin.put(
            f"/api/v1/admin/competitions/{competition_id}/team-singles/{single['id']}",
            json={
                "team1_player_id": single["team1_player"]["id"],
                "team2_player_id": single["team2_player"]["id"],
                "score1": 0 if index == 0 else 3,
                "score2": 3 if index == 0 else 0,
            },
        )
        assert corrected.status_code == 200, corrected.text
    current_snapshot = _snapshot(corrected.json()["doubles"])
    assert current_snapshot["id"] == old_snapshot["id"]
    assert current_snapshot["team1_player_ids"] != old_snapshot["team1_player_ids"]
    assert current_snapshot["team2_player_ids"] != old_snapshot["team2_player_ids"]
    before = _stored_result(api, competition_id)
    result = _save(admin, player, competition_id, encounter["id"], role, old_snapshot)
    assert result.status_code == 409, result.text
    assert result.json()["detail"] == STALE_MESSAGE
    assert _stored_result(api, competition_id) == before

    # Reloading the lineup and resubmitting succeeds without manual DB recovery.
    result = _save(admin, player, competition_id, encounter["id"], role, current_snapshot)
    assert result.status_code == 200, result.text
    assert result.json()["doubles"]["completed"] is True
    assert _stored_result(api, competition_id)["competition"][1] is not None


@pytest.mark.parametrize("role", ["admin", "player"])
@pytest.mark.parametrize("mismatch", ["id", "team1_player_ids", "team2_player_ids"])
def test_doubles_snapshot_compares_every_identity_field_without_changing_results(
    api, role, mismatch
):
    admin, player, competition_id, encounter = _pending_doubles(api)
    snapshot = _snapshot(encounter["doubles"])
    if mismatch == "id":
        snapshot["id"] += 100
    else:
        snapshot[mismatch][0] += 100
    before = _stored_result(api, competition_id)
    result = _save(admin, player, competition_id, encounter["id"], role, snapshot)
    assert result.status_code == 409, result.text
    assert result.json()["detail"] == STALE_MESSAGE
    assert _stored_result(api, competition_id) == before


@pytest.mark.parametrize("role", ["admin", "player"])
@pytest.mark.parametrize("include_snapshot", [False, True])
def test_current_doubles_snapshot_and_legacy_payload_keep_working(api, role, include_snapshot):
    admin, player, competition_id, encounter = _pending_doubles(api)
    snapshot = _snapshot(encounter["doubles"])
    # Order within each team is immaterial; team 2 submits scores from its own view.
    snapshot["team1_player_ids"].reverse()
    snapshot["team2_player_ids"].reverse()
    result = _save(
        admin,
        player,
        competition_id,
        encounter["id"],
        role,
        snapshot if include_snapshot else None,
    )
    assert result.status_code == 200, result.text
    double = result.json()["doubles"]
    assert (double["score1"], double["score2"]) == ((2, 1) if role == "admin" else (1, 2))
    assert _stored_result(api, competition_id)["competition"][1] is not None


@pytest.mark.parametrize("role", ["admin", "player"])
def test_invalid_doubles_snapshot_is_rejected_without_writing(api, role):
    admin, player, competition_id, encounter = _pending_doubles(api)
    before = _stored_result(api, competition_id)
    good = _snapshot(encounter["doubles"])
    for field, invalid_value in (
        ("id", 0),
        ("team1_player_ids", [1]),
        ("team1_player_ids", [1, 1]),
        ("team2_player_ids", [0, 2]),
        ("unexpected", True),
    ):
        snapshot = deepcopy(good)
        snapshot[field] = invalid_value
        result = _save(admin, player, competition_id, encounter["id"], role, snapshot)
        assert result.status_code == 422, result.text
        assert _stored_result(api, competition_id) == before


@pytest.mark.parametrize("role", ["admin", "player"])
def test_removed_doubles_lineup_rejects_the_open_form_without_recreating_results(api, role):
    admin, player, competition_id, encounter = _pending_doubles(api)
    snapshot = _snapshot(encounter["doubles"])
    removed = admin.delete(
        f"/api/v1/admin/competitions/{competition_id}/team-singles/{encounter['singles'][0]['id']}"
    )
    assert removed.status_code == 204, removed.text
    before = _stored_result(api, competition_id)
    assert before["doubles"] is None
    result = _save(admin, player, competition_id, encounter["id"], role, snapshot)
    assert result.status_code == 409, result.text
    assert result.json()["detail"] == STALE_MESSAGE
    assert _stored_result(api, competition_id) == before


def test_stale_admin_snapshot_preserves_existing_result_and_completion_time(api):
    admin, player, competition_id, encounter = _pending_doubles(api)
    snapshot = _snapshot(encounter["doubles"])
    result = _save(admin, player, competition_id, encounter["id"], "admin", snapshot)
    assert result.status_code == 200, result.text
    before = _stored_result(api, competition_id)
    assert before["competition"][1] is not None
    snapshot["team1_player_ids"][0] += 100
    result = _save(admin, player, competition_id, encounter["id"], "admin", snapshot)
    assert result.status_code == 409, result.text
    assert result.json()["detail"] == STALE_MESSAGE
    assert _stored_result(api, competition_id) == before
