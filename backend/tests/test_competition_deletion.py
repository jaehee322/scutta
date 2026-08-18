from __future__ import annotations

from sqlalchemy import func, select

from app.models import (
    Competition,
    CompetitionMember,
    CompetitionTeam,
    CompetitionTeamMember,
    LeagueFixture,
    Match,
    TeamDoublesGame,
    TeamEncounter,
    TeamSingleGame,
    User,
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
                "username": f"삭제선수{index}",
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


def _league(admin, players: list[dict], name: str) -> dict:
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


def _category(payload: dict, category: str) -> dict:
    return next(item for item in payload["categories"] if item["category"] == category)


def test_delete_competition_requires_admin_and_missing_returns_404(api) -> None:
    admin = _admin(api)
    players = _players(admin, 4)
    competition = _league(admin, players, "권한 확인 리그")
    url = f"/api/v1/admin/competitions/{competition['id']}"

    anonymous = api.client()
    assert anonymous.delete(url).status_code == 401

    player = _login(api, players[0]["username"])
    assert player.delete(url).status_code == 403
    assert admin.get(url).status_code == 200

    missing = admin.delete("/api/v1/admin/competitions/999999")
    assert missing.status_code == 404
    assert missing.json()["detail"] == "대회를 찾을 수 없습니다."

    assert admin.delete(url).status_code == 204
    assert admin.get(url).status_code == 404


def test_delete_league_reverts_stats_and_preserves_casual_match_and_other_data(api) -> None:
    admin = _admin(api)
    players = _players(admin, 4)
    deleted_competition = _league(admin, players, "삭제할 개인 리그")
    preserved_competition = _league(admin, players, "남길 개인 리그")
    fixture = deleted_competition["fixtures"][0]

    result = admin.put(
        f"/api/v1/admin/competitions/{deleted_competition['id']}"
        f"/league-fixtures/{fixture['id']}/result",
        json={"score1": 3, "score2": 0, "played_on": "2026-07-01"},
    )
    assert result.status_code == 200, result.text

    winner = fixture["player1"]
    loser = fixture["player2"]
    winner_client = _login(api, winner["username"])
    casual = winner_client.post(
        "/api/v1/matches",
        json={"opponent_id": loser["id"], "my_score": 2, "opponent_score": 1},
    )
    assert casual.status_code == 201, casual.text

    assert winner_client.get("/api/v1/players/me").json()["stats"] == {
        "matches": 2,
        "wins": 2,
        "losses": 0,
        "opponents": 1,
    }
    before_rankings = winner_client.get("/api/v1/rankings").json()
    before_entry = next(
        row
        for row in _category(before_rankings, "matches")["entries"]
        if row["player"]["id"] == winner["id"]
    )
    assert before_entry["value"] == 2
    assert _category(winner_client.get("/api/v1/settlements").json(), "wins")["value"] == 2

    response = admin.delete(f"/api/v1/admin/competitions/{deleted_competition['id']}")
    assert response.status_code == 204

    assert winner_client.get("/api/v1/players/me").json()["stats"] == {
        "matches": 1,
        "wins": 1,
        "losses": 0,
        "opponents": 1,
    }
    history = winner_client.get("/api/v1/matches?limit=50").json()
    assert history["total"] == 1
    assert history["items"][0]["id"] == casual.json()["id"]
    assert history["items"][0]["kind"] == "casual"

    after_rankings = winner_client.get("/api/v1/rankings").json()
    after_entry = next(
        row
        for row in _category(after_rankings, "matches")["entries"]
        if row["player"]["id"] == winner["id"]
    )
    assert after_entry["value"] == 1
    settlement = winner_client.get("/api/v1/settlements").json()
    assert _category(settlement, "matches")["value"] == 1
    assert _category(settlement, "wins")["value"] == 1

    assert admin.get(f"/api/v1/admin/competitions/{deleted_competition['id']}").status_code == 404
    assert admin.get(f"/api/v1/admin/competitions/{preserved_competition['id']}").status_code == 200
    assert admin.get("/api/v1/admin/matches?limit=200").json()["total"] == 1

    with api.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(Competition)) == 1
        assert db.scalar(select(func.count()).select_from(Match)) == 1
        assert (
            db.scalar(
                select(func.count()).select_from(Match).where(Match.competition_id.is_not(None))
            )
            == 0
        )
        assert db.scalar(select(func.count()).select_from(User)) == 5


def test_delete_completed_team_competition_cleans_all_children(api) -> None:
    admin = _admin(api)
    players = _players(admin, 8)
    preserved_league = _league(admin, players[:4], "남길 리그")
    created = admin.post(
        "/api/v1/admin/competitions",
        json={
            "name": "삭제할 단체전",
            "type": "team",
            "teams": [
                {"name": "A", "member_ids": [player["id"] for player in players[:4]]},
                {"name": "B", "member_ids": [player["id"] for player in players[4:]]},
            ],
        },
    )
    assert created.status_code == 201, created.text
    competition = created.json()
    encounter = competition["encounters"][0]
    team1 = encounter["team1"]["members"]
    team2 = encounter["team2"]["members"]

    for index in range(4):
        team1_wins = index < 2
        response = admin.post(
            f"/api/v1/admin/competitions/{competition['id']}"
            f"/team-encounters/{encounter['id']}/singles",
            json={
                "team1_player_id": team1[index]["id"],
                "team2_player_id": team2[index]["id"],
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
    assert admin.post(f"/api/v1/admin/competitions/{competition['id']}/complete").status_code == 200

    with api.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(CompetitionTeam)) == 2
        assert db.scalar(select(func.count()).select_from(CompetitionTeamMember)) == 8
        assert db.scalar(select(func.count()).select_from(TeamEncounter)) == 1
        assert db.scalar(select(func.count()).select_from(TeamSingleGame)) == 4
        assert db.scalar(select(func.count()).select_from(TeamDoublesGame)) == 1
        assert (
            db.scalar(
                select(func.count())
                .select_from(Match)
                .where(Match.competition_id == competition["id"])
            )
            == 4
        )

    deleted = admin.delete(f"/api/v1/admin/competitions/{competition['id']}")
    assert deleted.status_code == 204

    with api.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(Competition)) == 1
        assert db.scalar(select(func.count()).select_from(CompetitionMember)) == 4
        assert db.scalar(select(func.count()).select_from(LeagueFixture)) == 6
        assert db.scalar(select(func.count()).select_from(CompetitionTeam)) == 0
        assert db.scalar(select(func.count()).select_from(CompetitionTeamMember)) == 0
        assert db.scalar(select(func.count()).select_from(TeamEncounter)) == 0
        assert db.scalar(select(func.count()).select_from(TeamSingleGame)) == 0
        assert db.scalar(select(func.count()).select_from(TeamDoublesGame)) == 0
        assert db.scalar(select(func.count()).select_from(Match)) == 0
        assert db.scalar(select(func.count()).select_from(User)) == 9

    assert admin.get(f"/api/v1/admin/competitions/{competition['id']}").status_code == 404
    assert admin.get(f"/api/v1/admin/competitions/{preserved_league['id']}").status_code == 200
