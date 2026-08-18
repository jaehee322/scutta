from __future__ import annotations

from sqlalchemy import select

from app.models import (
    CompetitionTeam,
    CompetitionTeamMember,
    Match,
    TeamDoublesGame,
    TeamEncounter,
    TeamSingleGame,
)


def _admin(api):
    api.create_admin()
    client = api.client()
    api.login(client, "admin", "admin-password")
    return client


def _players(admin, count: int) -> list[dict]:
    players = []
    for index in range(1, count + 1):
        response = admin.post(
            "/api/v1/admin/players",
            json={
                "username": f"팀명선수{index}",
                "password": "20260000",
                "gender": "M" if index % 2 else "F",
                "club_rank": index % 7,
            },
        )
        assert response.status_code == 201, response.text
        players.append(response.json())
    return players


def _login(api, username: str):
    client = api.client()
    api.login(client, username, "20260000")
    return client


def _team_competition(admin, players: list[dict], name: str, team_names: list[str]) -> dict:
    assert len(players) == len(team_names) * 4
    response = admin.post(
        "/api/v1/admin/competitions",
        json={
            "name": name,
            "type": "team",
            "teams": [
                {
                    "name": team_name,
                    "member_ids": [player["id"] for player in players[index * 4 : index * 4 + 4]],
                }
                for index, team_name in enumerate(team_names)
            ],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _league(admin, players: list[dict]) -> dict:
    response = admin.post(
        "/api/v1/admin/competitions",
        json={
            "name": "개인 리그",
            "type": "league",
            "participant_ids": [player["id"] for player in players],
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _team_structure(db, competition_id: int) -> dict[str, list[tuple]]:
    return {
        "teams": [
            tuple(row)
            for row in db.execute(
                select(CompetitionTeam.id, CompetitionTeam.competition_id)
                .where(CompetitionTeam.competition_id == competition_id)
                .order_by(CompetitionTeam.id)
            )
        ],
        "members": [
            tuple(row)
            for row in db.execute(
                select(
                    CompetitionTeamMember.competition_id,
                    CompetitionTeamMember.team_id,
                    CompetitionTeamMember.user_id,
                )
                .where(CompetitionTeamMember.competition_id == competition_id)
                .order_by(CompetitionTeamMember.team_id, CompetitionTeamMember.user_id)
            )
        ],
        "encounters": [
            tuple(row)
            for row in db.execute(
                select(
                    TeamEncounter.id,
                    TeamEncounter.team1_id,
                    TeamEncounter.team2_id,
                    TeamEncounter.round_no,
                    TeamEncounter.order_no,
                )
                .where(TeamEncounter.competition_id == competition_id)
                .order_by(TeamEncounter.id)
            )
        ],
        "singles": [
            tuple(row)
            for row in db.execute(
                select(
                    TeamSingleGame.id,
                    TeamSingleGame.encounter_id,
                    TeamSingleGame.sequence,
                    TeamSingleGame.team1_player_id,
                    TeamSingleGame.team2_player_id,
                    TeamSingleGame.match_id,
                )
                .join(TeamEncounter, TeamEncounter.id == TeamSingleGame.encounter_id)
                .where(TeamEncounter.competition_id == competition_id)
                .order_by(TeamSingleGame.id)
            )
        ],
        "doubles": [
            tuple(row)
            for row in db.execute(
                select(
                    TeamDoublesGame.id,
                    TeamDoublesGame.encounter_id,
                    TeamDoublesGame.team1_player1_id,
                    TeamDoublesGame.team1_player2_id,
                    TeamDoublesGame.team2_player1_id,
                    TeamDoublesGame.team2_player2_id,
                    TeamDoublesGame.score1,
                    TeamDoublesGame.score2,
                )
                .join(TeamEncounter, TeamEncounter.id == TeamDoublesGame.encounter_id)
                .where(TeamEncounter.competition_id == competition_id)
                .order_by(TeamDoublesGame.id)
            )
        ],
        "matches": [
            tuple(row)
            for row in db.execute(
                select(
                    Match.id,
                    Match.player1_id,
                    Match.player2_id,
                    Match.score1,
                    Match.score2,
                    Match.played_on,
                )
                .where(Match.competition_id == competition_id)
                .order_by(Match.id)
            )
        ],
    }


def test_team_names_can_be_swapped_after_completion_without_rebuilding_data(api) -> None:
    admin = _admin(api)
    players = _players(admin, 8)
    competition = _team_competition(admin, players, "완료 단체전", ["A", "B"])
    encounter = competition["encounters"][0]
    team1 = encounter["team1"]
    team2 = encounter["team2"]

    for index in range(4):
        team1_wins = index < 2
        response = admin.post(
            f"/api/v1/admin/competitions/{competition['id']}"
            f"/team-encounters/{encounter['id']}/singles",
            json={
                "team1_player_id": team1["members"][index]["id"],
                "team2_player_id": team2["members"][index]["id"],
                "score1": 3 if team1_wins else 0,
                "score2": 0 if team1_wins else 3,
            },
        )
        assert response.status_code == 200, response.text
    doubles = admin.put(
        f"/api/v1/admin/competitions/{competition['id']}/team-encounters/{encounter['id']}/doubles",
        json={"score1": 2, "score2": 1},
    )
    assert doubles.status_code == 200, doubles.text
    completed = admin.post(f"/api/v1/admin/competitions/{competition['id']}/complete")
    assert completed.status_code == 200, completed.text

    participant = _login(api, team1["members"][0]["username"])
    stats_before = participant.get("/api/v1/players/me").json()["stats"]
    rankings_before = participant.get("/api/v1/rankings").json()
    settlement_before = participant.get("/api/v1/settlements").json()
    with api.session_factory() as db:
        structure_before = _team_structure(db, competition["id"])

    renamed = admin.patch(
        f"/api/v1/admin/competitions/{competition['id']}",
        json={
            "team_names": [
                {"id": team1["id"], "name": "B"},
                {"id": team2["id"], "name": "A"},
            ]
        },
    )
    assert renamed.status_code == 200, renamed.text
    detail = renamed.json()
    assert detail["status"] == "completed"
    assert {team["id"]: team["name"] for team in detail["teams"]} == {
        team1["id"]: "B",
        team2["id"]: "A",
    }
    assert {
        team["id"]: [member["id"] for member in team["members"]] for team in detail["teams"]
    } == {
        team1["id"]: [member["id"] for member in team1["members"]],
        team2["id"]: [member["id"] for member in team2["members"]],
    }
    renamed_encounter = detail["encounters"][0]
    assert renamed_encounter["id"] == encounter["id"]
    assert renamed_encounter["team1"]["name"] == "B"
    assert renamed_encounter["team2"]["name"] == "A"

    with api.session_factory() as db:
        assert _team_structure(db, competition["id"]) == structure_before
    assert participant.get("/api/v1/players/me").json()["stats"] == stats_before
    assert participant.get("/api/v1/rankings").json() == rankings_before
    assert participant.get("/api/v1/settlements").json() == settlement_before

    roster_update = admin.patch(
        f"/api/v1/admin/competitions/{competition['id']}",
        json={
            "teams": [
                {"name": "B", "member_ids": [member["id"] for member in team1["members"]]},
                {"name": "A", "member_ids": [member["id"] for member in team2["members"]]},
            ]
        },
    )
    assert roster_update.status_code == 409


def test_team_name_validation_rejects_inexact_ids_and_invalid_names_atomically(api) -> None:
    admin = _admin(api)
    players = _players(admin, 12)
    competition = _team_competition(admin, players, "원본 대회명", ["A", "B", "C"])
    foreign_competition = _team_competition(admin, players[:8], "다른 대회", ["X", "Y"])
    league = _league(admin, players[:4])
    baseline = admin.get(f"/api/v1/admin/competitions/{competition['id']}").json()
    baseline_teams = [(team["id"], team["name"]) for team in baseline["teams"]]
    baseline_encounters = [
        (encounter["id"], encounter["team1"]["id"], encounter["team2"]["id"])
        for encounter in baseline["encounters"]
    ]
    team_ids = [team["id"] for team in baseline["teams"]]
    foreign_id = foreign_competition["teams"][0]["id"]

    invalid_payloads = [
        {
            "name": "누락으로 바뀌면 안 됨",
            "team_names": [
                {"id": team_ids[0], "name": "D"},
                {"id": team_ids[1], "name": "E"},
            ],
        },
        {
            "name": "중복 ID로 바뀌면 안 됨",
            "team_names": [
                {"id": team_ids[0], "name": "D"},
                {"id": team_ids[0], "name": "E"},
                {"id": team_ids[2], "name": "F"},
            ],
        },
        {
            "name": "중복 이름으로 바뀌면 안 됨",
            "team_names": [
                {"id": team_ids[0], "name": "Same"},
                {"id": team_ids[1], "name": " same "},
                {"id": team_ids[2], "name": "Other"},
            ],
        },
        {
            "name": "정규화 중복으로 바뀌면 안 됨",
            "team_names": [
                {"id": team_ids[0], "name": "Ａ팀"},
                {"id": team_ids[1], "name": "a팀"},
                {"id": team_ids[2], "name": "Other"},
            ],
        },
        {
            "name": "외부 ID로 바뀌면 안 됨",
            "team_names": [
                {"id": team_ids[0], "name": "D"},
                {"id": team_ids[1], "name": "E"},
                {"id": foreign_id, "name": "F"},
            ],
        },
        {
            "name": "빈 이름으로 바뀌면 안 됨",
            "team_names": [
                {"id": team_ids[0], "name": "D"},
                {"id": team_ids[1], "name": "   "},
                {"id": team_ids[2], "name": "F"},
            ],
        },
    ]
    for payload in invalid_payloads:
        response = admin.patch(
            f"/api/v1/admin/competitions/{competition['id']}",
            json=payload,
        )
        assert response.status_code == 422, (payload, response.text)
        unchanged = admin.get(f"/api/v1/admin/competitions/{competition['id']}").json()
        assert unchanged["name"] == "원본 대회명"
        assert [(team["id"], team["name"]) for team in unchanged["teams"]] == baseline_teams
        assert [
            (encounter["id"], encounter["team1"]["id"], encounter["team2"]["id"])
            for encounter in unchanged["encounters"]
        ] == baseline_encounters

    league_rejected = admin.patch(
        f"/api/v1/admin/competitions/{league['id']}",
        json={
            "team_names": [
                {"id": team_ids[0], "name": "D"},
                {"id": team_ids[1], "name": "E"},
                {"id": team_ids[2], "name": "F"},
            ]
        },
    )
    assert league_rejected.status_code == 422
    assert admin.get(f"/api/v1/admin/competitions/{league['id']}").json()["name"] == "개인 리그"
    assert (
        admin.get(f"/api/v1/admin/competitions/{foreign_competition['id']}").json()["teams"]
        == foreign_competition["teams"]
    )
