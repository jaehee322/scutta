from __future__ import annotations

from collections.abc import Iterable

from sqlalchemy import select

from app.models import LeagueFixture


def _admin(api):
    admin_user = api.create_admin()
    client = api.client()
    api.login(client, "admin", "admin-password")
    return client, admin_user


def _players(admin, count: int, *, prefix: str = "선수") -> list[dict]:
    players = []
    for index in range(1, count + 1):
        response = admin.post(
            "/api/v1/admin/players",
            json={
                "username": f"{prefix}{index}",
                "password": "20260000",
                "gender": "M" if index % 2 else "F",
                "club_rank": (index % 9) - 2,
            },
        )
        assert response.status_code == 201, response.text
        players.append(response.json())
    return players


def _login(api, username: str):
    client = api.client()
    api.login(client, username, "20260000")
    return client


def _create_league(admin, players: Iterable[dict], *, name: str = "개인 리그") -> dict:
    response = admin.post(
        "/api/v1/admin/competitions",
        json={
            "name": name,
            "type": "league",
            "participant_ids": [player["id"] for player in players],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _team_payload(players: list[dict], *, prefix: str = "팀") -> list[dict]:
    assert len(players) % 4 == 0
    return [
        {
            "name": f"{prefix}{index // 4 + 1}",
            "member_ids": [player["id"] for player in players[index : index + 4]],
        }
        for index in range(0, len(players), 4)
    ]


def _create_team_competition(
    admin,
    players: list[dict],
    *,
    name: str = "단체 풀리그",
) -> dict:
    response = admin.post(
        "/api/v1/admin/competitions",
        json={"name": name, "type": "team", "teams": _team_payload(players)},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _category(payload: dict, category: str) -> dict:
    return next(item for item in payload["categories"] if item["category"] == category)


def _fixture_for(detail: dict, first_id: int, second_id: int) -> dict:
    expected = {first_id, second_id}
    return next(
        fixture
        for fixture in detail["fixtures"]
        if {fixture["player1"]["id"], fixture["player2"]["id"]} == expected
    )


def test_competition_creation_requires_admin_and_valid_rosters(api) -> None:
    admin, admin_user = _admin(api)
    players = _players(admin, 12)
    valid_league = {
        "name": "권한 확인 리그",
        "type": "league",
        "participant_ids": [player["id"] for player in players[:4]],
    }

    anonymous = api.client()
    assert anonymous.post("/api/v1/admin/competitions", json=valid_league).status_code == 401

    player_client = _login(api, players[0]["username"])
    assert player_client.post("/api/v1/admin/competitions", json=valid_league).status_code == 403
    assert player_client.get("/api/v1/admin/competitions").status_code == 403
    assert admin.get("/api/v1/competitions").status_code == 403

    invalid_payloads = [
        {
            "name": "3명 리그",
            "type": "league",
            "participant_ids": [player["id"] for player in players[:3]],
        },
        {
            "name": "7명 리그",
            "type": "league",
            "participant_ids": [player["id"] for player in players[:7]],
        },
        {
            "name": "중복 참가자",
            "type": "league",
            "participant_ids": [
                players[0]["id"],
                players[0]["id"],
                players[1]["id"],
                players[2]["id"],
            ],
        },
        {
            "name": "관리자 참가",
            "type": "league",
            "participant_ids": [
                admin_user.id,
                players[0]["id"],
                players[1]["id"],
                players[2]["id"],
            ],
        },
        {
            "name": "유형 혼합",
            "type": "league",
            "participant_ids": [player["id"] for player in players[:4]],
            "teams": _team_payload(players[:8]),
        },
        {
            "name": "한 팀뿐인 단체전",
            "type": "team",
            "teams": _team_payload(players[:4]),
        },
        {
            "name": "팀 인원 오류",
            "type": "team",
            "teams": [
                {
                    "name": "A",
                    "member_ids": [player["id"] for player in players[:3]],
                },
                {
                    "name": "B",
                    "member_ids": [player["id"] for player in players[4:8]],
                },
            ],
        },
        {
            "name": "팀 이름 중복",
            "type": "team",
            "teams": [
                {
                    "name": "Blue",
                    "member_ids": [player["id"] for player in players[:4]],
                },
                {
                    "name": "blue",
                    "member_ids": [player["id"] for player in players[4:8]],
                },
            ],
        },
        {
            "name": "정규화된 팀 이름 중복",
            "type": "team",
            "teams": [
                {
                    "name": "Ａ팀",
                    "member_ids": [player["id"] for player in players[:4]],
                },
                {
                    "name": "a팀",
                    "member_ids": [player["id"] for player in players[4:8]],
                },
            ],
        },
    ]
    for payload in invalid_payloads:
        response = admin.post("/api/v1/admin/competitions", json=payload)
        assert response.status_code == 422, (payload["name"], response.text)

    created = admin.post("/api/v1/admin/competitions", json=valid_league)
    assert created.status_code == 201, created.text
    assert (
        admin.patch(
            f"/api/v1/admin/competitions/{created.json()['id']}",
            json={"type": "team"},
        ).status_code
        == 422
    )


def test_league_player_permissions_orientation_stats_and_daily_conflicts(api) -> None:
    admin, _ = _admin(api)
    players = _players(admin, 4)
    detail = _create_league(admin, players)
    first = detail["fixtures"][0]
    player1 = first["player1"]
    player2 = first["player2"]
    third = next(player for player in players if player["id"] not in {player1["id"], player2["id"]})

    third_client = _login(api, third["username"])
    forbidden = third_client.post(
        f"/api/v1/competitions/{detail['id']}/league-fixtures/{first['id']}/result",
        json={"my_score": 3, "opponent_score": 0},
    )
    assert forbidden.status_code == 403

    player2_client = _login(api, player2["username"])
    submitted = player2_client.post(
        f"/api/v1/competitions/{detail['id']}/league-fixtures/{first['id']}/result",
        json={"my_score": 2, "opponent_score": 1},
    )
    assert submitted.status_code == 200, submitted.text
    assert submitted.json()["score1"] == 1
    assert submitted.json()["score2"] == 2
    assert submitted.json()["winner_id"] == player2["id"]
    assert submitted.json()["can_submit"] is False

    player1_client = _login(api, player1["username"])
    duplicate = player1_client.post(
        f"/api/v1/competitions/{detail['id']}/league-fixtures/{first['id']}/result",
        json={"my_score": 3, "opponent_score": 0},
    )
    assert duplicate.status_code == 409

    assert player2_client.get("/api/v1/players/me").json()["stats"] == {
        "matches": 1,
        "wins": 1,
        "losses": 0,
        "opponents": 1,
    }
    match_history = player2_client.get("/api/v1/matches?limit=50").json()
    assert match_history["total"] == 1
    assert match_history["items"][0]["kind"] == "competition"

    rankings = player2_client.get("/api/v1/rankings").json()
    wins = _category(rankings, "wins")["entries"]
    losses = _category(rankings, "losses")["entries"]
    assert next(row for row in wins if row["player"]["id"] == player2["id"])["value"] == 1
    assert next(row for row in losses if row["player"]["id"] == player1["id"])["value"] == 1
    settlement = player2_client.get("/api/v1/settlements").json()
    assert _category(settlement, "matches")["value"] == 1
    assert _category(settlement, "wins")["value"] == 1

    remaining_ids = [
        player["id"] for player in players if player["id"] not in {player1["id"], player2["id"]}
    ]
    casual_actor = next(player for player in players if player["id"] == remaining_ids[0])
    casual_opponent = next(player for player in players if player["id"] == remaining_ids[1])
    casual_client = _login(api, casual_actor["username"])
    casual = casual_client.post(
        "/api/v1/matches",
        json={
            "opponent_id": casual_opponent["id"],
            "my_score": 3,
            "opponent_score": 0,
        },
    )
    assert casual.status_code == 201, casual.text

    reverse_fixture = _fixture_for(detail, casual_actor["id"], casual_opponent["id"])
    reverse_client = _login(api, casual_opponent["username"])
    conflict = reverse_client.post(
        f"/api/v1/competitions/{detail['id']}/league-fixtures/{reverse_fixture['id']}/result",
        json={"my_score": 2, "opponent_score": 1},
    )
    assert conflict.status_code == 409
    refreshed = admin.get(f"/api/v1/admin/competitions/{detail['id']}").json()
    assert _fixture_for(refreshed, casual_actor["id"], casual_opponent["id"])["completed"] is False


def test_league_admin_crud_roster_lock_close_reopen_and_match_isolation(api) -> None:
    admin, _ = _admin(api)
    players = _players(admin, 5)
    detail = _create_league(admin, players[:4])
    competition_id = detail["id"]

    changed_roster = admin.patch(
        f"/api/v1/admin/competitions/{competition_id}",
        json={"participant_ids": [player["id"] for player in players[1:]]},
    )
    assert changed_roster.status_code == 200, changed_roster.text
    detail = changed_roster.json()
    assert {member["id"] for member in detail["members"]} == {
        player["id"] for player in players[1:]
    }
    assert admin.post(f"/api/v1/admin/competitions/{competition_id}/complete").status_code == 409

    first = detail["fixtures"][0]
    created = admin.put(
        f"/api/v1/admin/competitions/{competition_id}/league-fixtures/{first['id']}/result",
        json={"score1": 3, "score2": 0},
    )
    assert created.status_code == 200, created.text
    assert created.json()["winner_id"] == first["player1"]["id"]

    renamed = admin.patch(
        f"/api/v1/admin/competitions/{competition_id}",
        json={"name": "수정된 리그"},
    )
    assert renamed.status_code == 200, renamed.text
    assert renamed.json()["name"] == "수정된 리그"
    assert (
        admin.patch(
            f"/api/v1/admin/competitions/{competition_id}",
            json={"participant_ids": [player["id"] for player in players[:4]]},
        ).status_code
        == 409
    )

    updated = admin.put(
        f"/api/v1/admin/competitions/{competition_id}/league-fixtures/{first['id']}/result",
        json={"score1": 0, "score2": 3},
    )
    assert updated.status_code == 200, updated.text
    assert updated.json()["winner_id"] == first["player2"]["id"]

    with api.session_factory() as db:
        match_id = db.scalar(select(LeagueFixture.match_id).where(LeagueFixture.id == first["id"]))
    assert match_id is not None
    assert (
        admin.patch(
            f"/api/v1/admin/matches/{match_id}", json={"score1": 3, "score2": 0}
        ).status_code
        == 409
    )
    assert admin.delete(f"/api/v1/admin/matches/{match_id}").status_code == 409
    generic_list = admin.get("/api/v1/admin/matches?limit=200").json()
    assert generic_list["total"] == 0
    assert generic_list["items"] == []

    detail = admin.get(f"/api/v1/admin/competitions/{competition_id}").json()
    for fixture in detail["fixtures"]:
        if fixture["id"] == first["id"]:
            continue
        result = admin.put(
            f"/api/v1/admin/competitions/{competition_id}/league-fixtures/{fixture['id']}/result",
            json={"score1": 3, "score2": 0},
        )
        assert result.status_code == 200, result.text

    completed = admin.post(f"/api/v1/admin/competitions/{competition_id}/complete")
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"

    deleted = admin.delete(
        f"/api/v1/admin/competitions/{competition_id}/league-fixtures/{first['id']}/result"
    )
    assert deleted.status_code == 204
    reopened = admin.get(f"/api/v1/admin/competitions/{competition_id}").json()
    assert reopened["status"] == "active"
    assert reopened["completed_at"] is None
    assert (
        next(row for row in reopened["fixtures"] if row["id"] == first["id"])["completed"] is False
    )


def test_team_three_team_permissions_orientation_and_available_players(api) -> None:
    admin, _ = _admin(api)
    players = _players(admin, 12)
    detail = _create_team_competition(admin, players)
    assert detail["total_count"] == 3

    encounter = detail["encounters"][0]
    encounter_team_ids = {encounter["team1"]["id"], encounter["team2"]["id"]}
    third_team = next(team for team in detail["teams"] if team["id"] not in encounter_team_ids)
    third_client = _login(api, third_team["members"][0]["username"])
    third_view = third_client.get(f"/api/v1/competitions/{detail['id']}").json()
    third_encounter = next(row for row in third_view["encounters"] if row["id"] == encounter["id"])
    assert third_encounter["can_submit_singles"] is False
    forbidden = third_client.post(
        f"/api/v1/competitions/{detail['id']}/team-encounters/{encounter['id']}/singles",
        json={
            "my_team_player_id": third_team["members"][0]["id"],
            "opponent_team_player_id": encounter["team1"]["members"][0]["id"],
            "my_team_score": 3,
            "opponent_team_score": 0,
        },
    )
    assert forbidden.status_code == 403

    team1 = encounter["team1"]["members"]
    team2 = encounter["team2"]["members"]
    actor = _login(api, team2[0]["username"])
    selected_team2 = team2[1]
    selected_team1 = team1[2]
    submitted = actor.post(
        f"/api/v1/competitions/{detail['id']}/team-encounters/{encounter['id']}/singles",
        json={
            "my_team_player_id": selected_team2["id"],
            "opponent_team_player_id": selected_team1["id"],
            "my_team_score": 2,
            "opponent_team_score": 1,
        },
    )
    assert submitted.status_code == 200, submitted.text
    body = submitted.json()
    assert body["singles"][0]["team1_player"]["id"] == selected_team1["id"]
    assert body["singles"][0]["team2_player"]["id"] == selected_team2["id"]
    assert body["singles"][0]["score1"] == 1
    assert body["singles"][0]["score2"] == 2
    assert body["singles"][0]["winner_team_id"] == encounter["team2"]["id"]
    assert selected_team1["id"] not in {player["id"] for player in body["available_team1_players"]}
    assert selected_team2["id"] not in {player["id"] for player in body["available_team2_players"]}
    assert len(body["available_team1_players"]) == 3
    assert len(body["available_team2_players"]) == 3

    duplicate = actor.post(
        f"/api/v1/competitions/{detail['id']}/team-encounters/{encounter['id']}/singles",
        json={
            "my_team_player_id": selected_team2["id"],
            "opponent_team_player_id": team1[0]["id"],
            "my_team_score": 3,
            "opponent_team_score": 0,
        },
    )
    assert duplicate.status_code == 409


def test_team_three_to_one_finishes_without_doubles(api) -> None:
    admin, _ = _admin(api)
    players = _players(admin, 8)
    detail = _create_team_competition(admin, players)
    encounter = detail["encounters"][0]
    team1 = encounter["team1"]["members"]
    team2 = encounter["team2"]["members"]

    for index in range(4):
        response = admin.post(
            f"/api/v1/admin/competitions/{detail['id']}/team-encounters/{encounter['id']}/singles",
            json={
                "team1_player_id": team1[index]["id"],
                "team2_player_id": team2[index]["id"],
                "score1": 3 if index < 3 else 0,
                "score2": 0 if index < 3 else 3,
            },
        )
        assert response.status_code == 200, response.text

    result = response.json()
    assert result["completed"] is True
    assert result["team1_wins"] == 3
    assert result["team2_wins"] == 1
    assert result["winner_team_id"] == encounter["team1"]["id"]
    assert result["doubles"] is None
    completed = admin.post(f"/api/v1/admin/competitions/{detail['id']}/complete")
    assert completed.status_code == 200, completed.text
    assert completed.json()["standings"][0]["team"]["id"] == encounter["team1"]["id"]


def test_team_two_two_doubles_orientation_and_no_individual_stats(api) -> None:
    admin, _ = _admin(api)
    players = _players(admin, 8)
    detail = _create_team_competition(admin, players)
    encounter = detail["encounters"][0]
    team1 = encounter["team1"]["members"]
    team2 = encounter["team2"]["members"]
    submitter = _login(api, team1[0]["username"])

    for index in range(4):
        team1_wins = index < 2
        response = submitter.post(
            f"/api/v1/competitions/{detail['id']}/team-encounters/{encounter['id']}/singles",
            json={
                "my_team_player_id": team1[index]["id"],
                "opponent_team_player_id": team2[index]["id"],
                "my_team_score": 3 if team1_wins else 0,
                "opponent_team_score": 0 if team1_wins else 3,
            },
        )
        assert response.status_code == 200, response.text

    pending = response.json()
    assert pending["completed"] is False
    assert pending["doubles"]["completed"] is False
    assert {row["id"] for row in pending["doubles"]["team1_players"]} == {
        team1[2]["id"],
        team1[3]["id"],
    }
    assert {row["id"] for row in pending["doubles"]["team2_players"]} == {
        team2[0]["id"],
        team2[1]["id"],
    }

    doubles_participant = _login(api, team1[2]["username"])
    profile_before = doubles_participant.get("/api/v1/players/me").json()["stats"]
    rankings_before = doubles_participant.get("/api/v1/rankings").json()
    settlement_before = doubles_participant.get("/api/v1/settlements").json()

    team2_actor = _login(api, team2[3]["username"])
    doubles = team2_actor.post(
        f"/api/v1/competitions/{detail['id']}/team-encounters/{encounter['id']}/doubles",
        json={"my_team_score": 2, "opponent_team_score": 1},
    )
    assert doubles.status_code == 200, doubles.text
    result = doubles.json()
    assert result["doubles"]["score1"] == 1
    assert result["doubles"]["score2"] == 2
    assert result["doubles"]["winner_team_id"] == encounter["team2"]["id"]
    assert result["team1_wins"] == 2
    assert result["team2_wins"] == 3
    assert result["completed"] is True

    assert doubles_participant.get("/api/v1/players/me").json()["stats"] == profile_before
    assert doubles_participant.get("/api/v1/rankings").json() == rankings_before
    assert doubles_participant.get("/api/v1/settlements").json() == settlement_before
    duplicate = submitter.post(
        f"/api/v1/competitions/{detail['id']}/team-encounters/{encounter['id']}/doubles",
        json={"my_team_score": 3, "opponent_team_score": 0},
    )
    assert duplicate.status_code == 409


def test_team_admin_result_crud_roster_lock_close_and_reopen(api) -> None:
    admin, _ = _admin(api)
    players = _players(admin, 8)
    detail = _create_team_competition(admin, players)
    competition_id = detail["id"]

    renamed_teams = _team_payload(players, prefix="새 팀")
    roster_update = admin.patch(
        f"/api/v1/admin/competitions/{competition_id}",
        json={"teams": renamed_teams},
    )
    assert roster_update.status_code == 200, roster_update.text
    detail = roster_update.json()
    assert [team["name"] for team in detail["teams"]] == ["새 팀1", "새 팀2"]
    assert admin.post(f"/api/v1/admin/competitions/{competition_id}/complete").status_code == 409

    encounter = detail["encounters"][0]
    team1 = encounter["team1"]["members"]
    team2 = encounter["team2"]["members"]
    for index in range(4):
        team1_wins = index < 2
        response = admin.post(
            f"/api/v1/admin/competitions/{competition_id}/team-encounters/{encounter['id']}/singles",
            json={
                "team1_player_id": team1[index]["id"],
                "team2_player_id": team2[index]["id"],
                "score1": 3 if team1_wins else 0,
                "score2": 0 if team1_wins else 3,
            },
        )
        assert response.status_code == 200, response.text
    result = response.json()
    singles = result["singles"]
    assert result["doubles"] is not None

    assert (
        admin.patch(
            f"/api/v1/admin/competitions/{competition_id}",
            json={"teams": _team_payload(players, prefix="잠긴 팀")},
        ).status_code
        == 409
    )

    updated_single = admin.put(
        f"/api/v1/admin/competitions/{competition_id}/team-singles/{singles[0]['id']}",
        json={
            "team1_player_id": team1[0]["id"],
            "team2_player_id": team2[0]["id"],
            "score1": 2,
            "score2": 1,
        },
    )
    assert updated_single.status_code == 200, updated_single.text
    assert updated_single.json()["singles"][0]["score1"] == 2
    assert updated_single.json()["singles"][0]["score2"] == 1

    deleted_single = admin.delete(
        f"/api/v1/admin/competitions/{competition_id}/team-singles/{singles[3]['id']}"
    )
    assert deleted_single.status_code == 204
    after_single_delete = admin.get(f"/api/v1/admin/competitions/{competition_id}").json()
    encounter_after_delete = after_single_delete["encounters"][0]
    assert len(encounter_after_delete["singles"]) == 3
    assert encounter_after_delete["doubles"] is None

    recreated = admin.post(
        f"/api/v1/admin/competitions/{competition_id}/team-encounters/{encounter['id']}/singles",
        json={
            "team1_player_id": team1[3]["id"],
            "team2_player_id": team2[3]["id"],
            "score1": 0,
            "score2": 3,
        },
    )
    assert recreated.status_code == 200, recreated.text
    assert recreated.json()["doubles"] is not None

    created_doubles = admin.put(
        f"/api/v1/admin/competitions/{competition_id}/team-encounters/{encounter['id']}/doubles",
        json={"score1": 2, "score2": 1},
    )
    assert created_doubles.status_code == 200, created_doubles.text
    assert created_doubles.json()["completed"] is True
    completed = admin.post(f"/api/v1/admin/competitions/{competition_id}/complete")
    assert completed.status_code == 200, completed.text
    assert completed.json()["status"] == "completed"

    updated_doubles = admin.put(
        f"/api/v1/admin/competitions/{competition_id}/team-encounters/{encounter['id']}/doubles",
        json={"score1": 3, "score2": 0},
    )
    assert updated_doubles.status_code == 200, updated_doubles.text
    assert updated_doubles.json()["doubles"]["score1"] == 3
    assert updated_doubles.json()["doubles"]["score2"] == 0

    deleted_doubles = admin.delete(
        f"/api/v1/admin/competitions/{competition_id}/team-encounters/{encounter['id']}/doubles"
    )
    assert deleted_doubles.status_code == 204
    reopened = admin.get(f"/api/v1/admin/competitions/{competition_id}").json()
    assert reopened["status"] == "active"
    assert reopened["completed_at"] is None
    assert reopened["encounters"][0]["doubles"]["completed"] is False

    team_member = _login(api, team1[0]["username"])
    player_view = team_member.get(f"/api/v1/competitions/{competition_id}").json()
    assert player_view["encounters"][0]["can_submit_doubles"] is True
