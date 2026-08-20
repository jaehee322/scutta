from __future__ import annotations

from itertools import combinations

import pytest
from sqlalchemy import event, func, select

from app.models import (
    Competition,
    CompetitionTeam,
    CompetitionTeamMember,
    LeagueFixture,
    Match,
    TeamDoublesGame,
    TeamEncounter,
    TeamSingleGame,
)
from app.services.competitions import list_competitions


def _admin(api):
    api.create_admin()
    client = api.client()
    api.login(client, "admin", "admin-password")
    return client


def _players(admin, count: int, *, prefix: str = "P") -> list[dict]:
    result = []
    for index in range(1, count + 1):
        response = admin.post(
            "/api/v1/admin/players",
            json={
                "username": f"{prefix}{index}",
                "password": "20260000",
                "gender": "M" if index % 2 else "F",
                "club_rank": (index % 7) - 1,
            },
        )
        assert response.status_code == 201, response.text
        result.append(response.json())
    return result


def _login(api, username: str):
    client = api.client()
    api.login(client, username, "20260000")
    return client


@pytest.mark.parametrize(("participant_count", "fixture_count"), [(4, 6), (5, 10), (6, 15)])
def test_individual_league_generates_balanced_round_robin(
    api, participant_count: int, fixture_count: int
) -> None:
    admin = _admin(api)
    players = _players(admin, participant_count)
    response = admin.post(
        "/api/v1/admin/competitions",
        json={
            "name": f"{participant_count}인 리그",
            "type": "league",
            "participant_ids": [player["id"] for player in players],
        },
    )
    assert response.status_code == 201, response.text
    detail = response.json()
    assert detail["total_count"] == fixture_count
    assert len(detail["fixtures"]) == fixture_count
    pairs = {
        tuple(sorted((fixture["player1"]["id"], fixture["player2"]["id"])))
        for fixture in detail["fixtures"]
    }
    assert pairs == set(combinations(sorted(player["id"] for player in players), 2))
    for round_no in {fixture["round_no"] for fixture in detail["fixtures"]}:
        round_players = [
            player_id
            for fixture in detail["fixtures"]
            if fixture["round_no"] == round_no
            for player_id in (fixture["player1"]["id"], fixture["player2"]["id"])
        ]
        assert len(round_players) == len(set(round_players))


def test_competition_roster_validation(api) -> None:
    admin = _admin(api)
    players = _players(admin, 8)
    ids = [player["id"] for player in players]
    assert (
        admin.post(
            "/api/v1/admin/competitions",
            json={"name": "작은 리그", "type": "league", "participant_ids": ids[:3]},
        ).status_code
        == 422
    )
    assert (
        admin.post(
            "/api/v1/admin/competitions",
            json={
                "name": "중복 팀",
                "type": "team",
                "teams": [
                    {"name": "A", "member_ids": ids[:4]},
                    {"name": "B", "member_ids": [ids[3], *ids[5:8]]},
                ],
            },
        ).status_code
        == 422
    )
    assert (
        admin.post(
            "/api/v1/admin/competitions",
            json={
                "name": "관리자 참가",
                "type": "league",
                "participant_ids": [1, *ids[:3]],
            },
        ).status_code
        == 422
    )


def _create_team_competition(admin, players: list[dict], team_count: int = 2) -> dict:
    teams = []
    for team_index in range(team_count):
        start = team_index * 4
        teams.append(
            {
                "name": f"T{team_index + 1}",
                "member_ids": [player["id"] for player in players[start : start + 4]],
            }
        )
    response = admin.post(
        "/api/v1/admin/competitions",
        json={"name": "단체 풀리그", "type": "team", "teams": teams},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_team_round_robin_and_dynamic_singles_doubles(api) -> None:
    admin = _admin(api)
    players = _players(admin, 12)
    three_team_detail = _create_team_competition(admin, players, team_count=3)
    assert three_team_detail["total_count"] == 3
    assert (
        len(
            {
                tuple(sorted((row["team1"]["id"], row["team2"]["id"])))
                for row in three_team_detail["encounters"]
            }
        )
        == 3
    )

    # Use a separate two-team event so its only encounter can be completed and closed.
    detail = _create_team_competition(admin, players[:8], team_count=2)
    competition_id = detail["id"]
    encounter = detail["encounters"][0]
    encounter_id = encounter["id"]
    team1 = encounter["team1"]["members"]
    team2 = encounter["team2"]["members"]
    actor = _login(api, team1[0]["username"])
    outsider = _login(api, players[8]["username"])

    forbidden = outsider.post(
        f"/api/v1/competitions/{competition_id}/team-encounters/{encounter_id}/singles",
        json={
            "my_team_player_id": players[8]["id"],
            "opponent_team_player_id": team1[0]["id"],
            "my_team_score": 3,
            "opponent_team_score": 0,
        },
    )
    assert forbidden.status_code == 403

    for index in range(4):
        team1_wins = index < 2
        result = actor.post(
            f"/api/v1/competitions/{competition_id}/team-encounters/{encounter_id}/singles",
            json={
                "my_team_player_id": team1[index]["id"],
                "opponent_team_player_id": team2[index]["id"],
                "my_team_score": 3 if team1_wins else 0,
                "opponent_team_score": 0 if team1_wins else 3,
            },
        )
        assert result.status_code == 200, result.text
        body = result.json()
        assert len(body["available_team1_players"]) == 3 - index
        assert len(body["available_team2_players"]) == 3 - index

    encounter = result.json()
    assert encounter["completed"] is False
    assert encounter["doubles"]["team1_players"] == team1[2:]
    assert encounter["doubles"]["team2_players"] == team2[:2]
    assert encounter["can_submit_doubles"] is True

    duplicate = actor.post(
        f"/api/v1/competitions/{competition_id}/team-encounters/{encounter_id}/singles",
        json={
            "my_team_player_id": team1[0]["id"],
            "opponent_team_player_id": team2[0]["id"],
            "my_team_score": 3,
            "opponent_team_score": 0,
        },
    )
    assert duplicate.status_code == 409

    team2_actor = _login(api, team2[3]["username"])
    doubles = team2_actor.post(
        f"/api/v1/competitions/{competition_id}/team-encounters/{encounter_id}/doubles",
        json={"my_team_score": 2, "opponent_team_score": 1},
    )
    assert doubles.status_code == 200, doubles.text
    assert doubles.json()["winner_team_id"] == encounter["team2"]["id"]
    assert doubles.json()["team1_wins"] == 2
    assert doubles.json()["team2_wins"] == 3
    assert admin.post(f"/api/v1/admin/competitions/{competition_id}/complete").status_code == 200

    with api.session_factory() as db:
        competition_matches = (
            select(func.count()).select_from(Match).where(Match.competition_id == competition_id)
        )
        assert db.scalar(competition_matches) == 4
        assert db.scalar(select(func.count()).select_from(TeamDoublesGame)) == 1


def test_doubles_invalidation_and_completed_reopen(api) -> None:
    admin = _admin(api)
    players = _players(admin, 8)
    detail = _create_team_competition(admin, players)
    competition_id = detail["id"]
    encounter = detail["encounters"][0]
    encounter_id = encounter["id"]
    team1 = encounter["team1"]["members"]
    team2 = encounter["team2"]["members"]

    for index in range(4):
        response = admin.post(
            f"/api/v1/admin/competitions/{competition_id}/team-encounters/{encounter_id}/singles",
            json={
                "team1_player_id": team1[index]["id"],
                "team2_player_id": team2[index]["id"],
                "score1": 3 if index < 2 else 0,
                "score2": 0 if index < 2 else 3,
            },
        )
        assert response.status_code == 200, response.text
    encounter = response.json()
    double_id = encounter["doubles"]["id"]
    singles = encounter["singles"]
    assert (
        admin.put(
            f"/api/v1/admin/competitions/{competition_id}/team-encounters/{encounter_id}/doubles",
            json={"score1": 2, "score2": 1},
        ).status_code
        == 200
    )
    assert admin.post(f"/api/v1/admin/competitions/{competition_id}/complete").status_code == 200

    same_winner = admin.put(
        f"/api/v1/admin/competitions/{competition_id}/team-singles/{singles[0]['id']}",
        json={
            "team1_player_id": team1[0]["id"],
            "team2_player_id": team2[0]["id"],
            "score1": 2,
            "score2": 1,
        },
    )
    assert same_winner.status_code == 200, same_winner.text
    assert same_winner.json()["doubles"]["id"] == double_id
    assert same_winner.json()["doubles"]["completed"] is True
    assert admin.get(f"/api/v1/admin/competitions/{competition_id}").json()["status"] == "completed"

    changed_losers = admin.put(
        f"/api/v1/admin/competitions/{competition_id}/team-singles/{singles[0]['id']}",
        json={
            "team1_player_id": team1[0]["id"],
            "team2_player_id": team2[0]["id"],
            "score1": 0,
            "score2": 3,
        },
    )
    assert changed_losers.status_code == 200, changed_losers.text
    assert changed_losers.json()["doubles"] is None
    assert changed_losers.json()["completed"] is True
    assert admin.get(f"/api/v1/admin/competitions/{competition_id}").json()["status"] == "completed"

    # Flip a former team-2 win: the encounter becomes 2:2 with new losers and needs doubles again.
    pending_again = admin.put(
        f"/api/v1/admin/competitions/{competition_id}/team-singles/{singles[2]['id']}",
        json={
            "team1_player_id": team1[2]["id"],
            "team2_player_id": team2[2]["id"],
            "score1": 3,
            "score2": 0,
        },
    )
    assert pending_again.status_code == 200, pending_again.text
    assert pending_again.json()["doubles"]["completed"] is False
    assert admin.get(f"/api/v1/admin/competitions/{competition_id}").json()["status"] == "active"


def test_league_standings_daily_rule_completion_and_admin_isolation(api) -> None:
    admin = _admin(api)
    players = _players(admin, 4)
    response = admin.post(
        "/api/v1/admin/competitions",
        json={
            "name": "순위 리그",
            "type": "league",
            "participant_ids": [player["id"] for player in players],
        },
    )
    detail = response.json()
    competition_id = detail["id"]
    fixtures = {
        frozenset((row["player1"]["id"], row["player2"]["id"])): row for row in detail["fixtures"]
    }
    ids = [player["id"] for player in players]
    outcomes = {
        frozenset((ids[0], ids[1])): (ids[0], 2, 1),
        frozenset((ids[0], ids[2])): (ids[2], 3, 0),
        frozenset((ids[0], ids[3])): (ids[0], 2, 1),
        frozenset((ids[1], ids[2])): (ids[1], 3, 0),
        frozenset((ids[1], ids[3])): (ids[1], 3, 0),
        frozenset((ids[2], ids[3])): (ids[3], 3, 0),
    }
    first_match_id = None
    for pair, (winner_id, winner_score, loser_score) in outcomes.items():
        fixture = fixtures[pair]
        score1 = winner_score if fixture["player1"]["id"] == winner_id else loser_score
        score2 = winner_score if fixture["player2"]["id"] == winner_id else loser_score
        result = admin.put(
            f"/api/v1/admin/competitions/{competition_id}/league-fixtures/{fixture['id']}/result",
            json={"score1": score1, "score2": score2},
        )
        assert result.status_code == 200, result.text
        if first_match_id is None:
            with api.session_factory() as db:
                first_match_id = db.scalar(
                    select(LeagueFixture.match_id).where(LeagueFixture.id == fixture["id"])
                )

    detail = admin.get(f"/api/v1/admin/competitions/{competition_id}").json()
    assert [(row["player"]["id"], row["rank"]) for row in detail["standings"][:2]] == [
        (ids[0], 1),
        (ids[1], 2),
    ]
    assert detail["standings"][0]["set_difference"] < detail["standings"][1]["set_difference"]
    assert admin.post(f"/api/v1/admin/competitions/{competition_id}/complete").status_code == 200

    assert first_match_id is not None
    assert (
        admin.patch(
            f"/api/v1/admin/matches/{first_match_id}", json={"score1": 3, "score2": 0}
        ).status_code
        == 409
    )
    assert admin.delete(f"/api/v1/admin/matches/{first_match_id}").status_code == 409
    assert admin.get("/api/v1/admin/matches?limit=200").json()["total"] == 0

    deleted_fixture = detail["fixtures"][0]
    assert (
        admin.delete(
            f"/api/v1/admin/competitions/{competition_id}/league-fixtures/"
            f"{deleted_fixture['id']}/result"
        ).status_code
        == 204
    )
    reopened = admin.get(f"/api/v1/admin/competitions/{competition_id}").json()
    assert reopened["status"] == "active"
    assert reopened["completed_at"] is None


def test_competition_single_conflicts_with_same_day_casual_match(api) -> None:
    admin = _admin(api)
    players = _players(admin, 4)
    detail = admin.post(
        "/api/v1/admin/competitions",
        json={
            "name": "일일 제한",
            "type": "league",
            "participant_ids": [player["id"] for player in players],
        },
    ).json()
    fixture = detail["fixtures"][0]
    actor = _login(api, fixture["player1"]["username"])
    submitted = actor.post(
        f"/api/v1/competitions/{detail['id']}/league-fixtures/{fixture['id']}/result",
        json={"my_score": 3, "opponent_score": 0},
    )
    assert submitted.status_code == 200, submitted.text
    assert (
        actor.post(
            "/api/v1/matches",
            json={
                "opponent_id": fixture["player2"]["id"],
                "my_score": 2,
                "opponent_score": 1,
            },
        ).status_code
        == 409
    )
    profile = actor.get("/api/v1/players/me").json()
    assert profile["stats"]["matches"] == 1
    assert profile["stats"]["wins"] == 1


def test_reset_removes_all_competition_children(api) -> None:
    admin = _admin(api)
    players = _players(admin, 8)
    detail = _create_team_competition(admin, players)
    preview = admin.get("/api/v1/admin/database/reset-preview").json()
    assert preview["competitions"] == 1
    assert preview["competition_members"] == 8
    reset = admin.post(
        "/api/v1/admin/database/reset",
        json={
            "confirmation": "모든 경기, 대회와 선수 데이터를 삭제합니다",
            "admin_password": "admin-password",
        },
    )
    assert reset.status_code == 200, reset.text
    assert reset.json()["deleted"]["competition_members"] == 8
    with api.session_factory() as db:
        for model in (
            Competition,
            CompetitionTeam,
            CompetitionTeamMember,
            TeamEncounter,
            TeamSingleGame,
            TeamDoublesGame,
            Match,
        ):
            assert db.scalar(select(func.count()).select_from(model)) == 0
    assert detail["id"] > 0


def test_competition_list_progress_uses_constant_query_count(api) -> None:
    admin = _admin(api)
    players = _players(admin, 8)
    player_ids = [player["id"] for player in players]
    team_details = []
    for index in range(3):
        response = admin.post(
            "/api/v1/admin/competitions",
            json={
                "name": f"개인 리그 {index + 1}",
                "type": "league",
                "participant_ids": player_ids[:4],
            },
        )
        assert response.status_code == 201, response.text
        team_details.append(_create_team_competition(admin, players))

    def submit_team_singles(detail: dict, *, opponent_shift: int, team1_wins: int) -> None:
        encounter = detail["encounters"][0]
        team1 = encounter["team1"]["members"]
        team2 = encounter["team2"]["members"]
        for index, player in enumerate(team1):
            response = admin.post(
                f"/api/v1/admin/competitions/{detail['id']}/team-encounters/"
                f"{encounter['id']}/singles",
                json={
                    "team1_player_id": player["id"],
                    "team2_player_id": team2[(index + opponent_shift) % 4]["id"],
                    "score1": 3 if index < team1_wins else 0,
                    "score2": 0 if index < team1_wins else 3,
                },
            )
            assert response.status_code == 200, response.text

    # Exercise both completion paths: a decisive 4:0 encounter and a 2:2
    # encounter completed by doubles. The third team competition stays empty.
    submit_team_singles(team_details[0], opponent_shift=0, team1_wins=4)
    submit_team_singles(team_details[1], opponent_shift=1, team1_wins=2)
    tied_encounter = team_details[1]["encounters"][0]
    doubles = admin.put(
        f"/api/v1/admin/competitions/{team_details[1]['id']}/team-encounters/"
        f"{tied_encounter['id']}/doubles",
        json={"score1": 3, "score2": 0},
    )
    assert doubles.status_code == 200, doubles.text

    statements: list[str] = []

    def count_statement(*args) -> None:
        statements.append(args[2])

    with api.session_factory() as db:
        engine = db.get_bind()
        event.listen(engine, "before_cursor_execute", count_statement)
        try:
            summaries = list_competitions(
                db,
                status=None,
                competition_type=None,
            )
        finally:
            event.remove(engine, "before_cursor_execute", count_statement)

    assert len(summaries) == 6
    assert len(statements) == 3
    assert {summary.total_count for summary in summaries if summary.type.value == "league"} == {6}
    assert {summary.total_count for summary in summaries if summary.type.value == "team"} == {1}
    by_id = {summary.id: summary for summary in summaries}
    assert by_id[team_details[0]["id"]].completed_count == 1
    assert by_id[team_details[1]["id"]].completed_count == 1
    assert by_id[team_details[2]["id"]].completed_count == 0
