from __future__ import annotations

from datetime import date
from itertools import combinations

from app.models import (
    CompetitionTeam,
    LeagueFixture,
    Match,
    MatchKind,
    TeamEncounter,
    TeamSingleGame,
)
from app.schemas.competitions import CompetitionPlayer
from app.services.competitions import _league_standings, _team_standings


def _league(names, results):
    players = {
        index: CompetitionPlayer(id=index, username=name, club_rank=3)
        for index, name in enumerate(names, start=1)
    }
    scores = {}
    for left, right, left_score, right_score in results:
        if left > right:
            left, right, left_score, right_score = right, left, right_score, left_score
        scores[left, right] = (left_score, right_score)
    fixtures = []
    for index, (left, right) in enumerate(combinations(players, 2), start=1):
        score = scores.get((left, right))
        fixture = LeagueFixture(
            id=index,
            competition_id=1,
            player1_id=left,
            player2_id=right,
            round_no=1,
            order_no=index,
            match_id=index if score else None,
        )
        match = (
            None
            if score is None
            else Match(
                id=index,
                competition_id=1,
                player1_id=left,
                player2_id=right,
                score1=score[0],
                score2=score[1],
                kind=MatchKind.COMPETITION,
                played_on=date(2026, 9, 11),
            )
        )
        fixtures.append((fixture, match))
    return _league_standings(list(players), players, fixtures)


def _teams(names, results):
    teams = [
        CompetitionTeam(id=index, name=name, competition_id=1)
        for index, name in enumerate(names, start=1)
    ]
    scores = {}
    for left, right, games in results:
        if left > right:
            left, right, games = right, left, [(b, a) for a, b in games]
        scores[left, right] = games
    encounters = []
    singles = {}
    for index, (left, right) in enumerate(combinations(range(1, len(teams) + 1), 2), start=1):
        encounters.append(
            TeamEncounter(
                id=index,
                competition_id=1,
                team1_id=left,
                team2_id=right,
                round_no=1,
                order_no=index,
            )
        )
        singles[index] = []
        for sequence, (score1, score2) in enumerate(scores.get((left, right), []), start=1):
            # Reverse player IDs relative to team IDs to exercise canonical score orientation.
            player1, player2 = 100 - left * 10 + sequence, 100 - right * 10 + sequence
            match_id = index * 10 + sequence
            single = TeamSingleGame(
                id=match_id,
                encounter_id=index,
                sequence=sequence,
                team1_player_id=player1,
                team2_player_id=player2,
                match_id=match_id,
            )
            match = Match(
                id=match_id,
                competition_id=1,
                player1_id=player2,
                player2_id=player1,
                score1=score2,
                score2=score1,
                kind=MatchKind.COMPETITION,
                played_on=date(2026, 9, 11),
            )
            singles[index].append((single, match))
    return _team_standings(teams, encounters, singles, {})


def test_league_third_key_is_sets_won_instead_of_set_difference():
    rows = _league(
        ["A", "B", "C", "D"],
        [(1, 3, 3, 0), (2, 4, 3, 0), (3, 2, 2, 1), (3, 4, 3, 0)],
    )
    by_id = {row.player.id: row for row in rows}
    # A and B each have one win and no direct result. B's set from a loss
    # puts it above A even though A has the better set difference.
    assert by_id[1].wins == by_id[2].wins == 1
    assert by_id[1].set_difference == 3 > by_id[2].set_difference == 2
    assert by_id[2].sets_won == 4 > by_id[1].sets_won == 3
    assert [row.player.id for row in rows] == [3, 2, 1, 4]


def test_league_total_wins_and_tied_group_wins_precede_sets_won():
    rows = _league(
        ["A", "B", "C", "D", "E"],
        [(4, 1, 2, 1), (4, 3, 2, 1), (2, 3, 3, 0), (1, 2, 2, 1), (5, 2, 2, 1)],
    )
    by_id = {row.player.id: row for row in rows}
    assert by_id[2].sets_won == 5 > by_id[4].sets_won == 4
    assert by_id[4].wins == 2 and by_id[4].rank == 1
    assert by_id[1].wins == by_id[2].wins == 1
    assert by_id[1].sets_won == 3 < by_id[2].sets_won
    assert by_id[1].rank < by_id[2].rank  # A beat B within their one-win group.


def test_league_equal_sporting_keys_share_rank_and_names_only_order_display():
    rows = _league(["Zulu", "Alpha", "beta", "Gamma"], [(1, 3, 2, 1), (2, 4, 2, 1)])
    assert [(row.player.id, row.rank) for row in rows] == [(2, 1), (1, 1), (3, 3), (4, 3)]


def test_team_third_key_uses_sets_not_game_difference():
    rows = _teams(
        ["A", "B", "C", "D"],
        [
            (1, 3, [(2, 1)] * 4),
            (2, 4, [(3, 0)] * 3 + [(1, 2)]),
            (3, 2, [(0, 3)] + [(2, 1)] * 3),
            (3, 4, [(2, 1)] * 3 + [(0, 3)]),
        ],
    )
    by_id = {row.team.id: row for row in rows}
    assert by_id[1].wins == by_id[2].wins == 1
    assert by_id[1].game_difference == 4 > by_id[2].game_difference == 0
    assert by_id[2].sets_won == 16 > by_id[1].sets_won == 8
    assert [row.team.id for row in rows] == [3, 2, 1, 4]
    assert (by_id[2].games_won, by_id[2].games_lost) == (4, 4)


def test_team_total_wins_and_tied_group_wins_precede_sets_won():
    rows = _teams(
        ["A", "B", "C", "D"],
        [
            (1, 2, [(2, 1)] * 3 + [(0, 3)]),
            (2, 3, [(3, 0)] * 4),
            (4, 1, [(2, 1)] * 4),
            (4, 3, [(2, 1)] * 4),
        ],
    )
    by_id = {row.team.id: row for row in rows}
    assert by_id[2].sets_won == 18 > by_id[4].sets_won == 16
    assert by_id[4].wins == 2 and by_id[4].rank == 1
    assert by_id[1].wins == by_id[2].wins == 1
    assert by_id[1].sets_won == 10 < by_id[2].sets_won
    assert [row.team.id for row in rows] == [4, 1, 2, 3]


def test_team_equal_sporting_keys_share_rank_and_names_only_order_display():
    games = [(2, 1)] * 3 + [(0, 3)]
    rows = _teams(["Zulu", "Alpha", "beta", "Gamma"], [(1, 3, games), (2, 4, games)])
    assert [(row.team.id, row.rank) for row in rows] == [(2, 1), (1, 1), (3, 3), (4, 3)]


def test_team_api_counts_partial_singles_and_doubles_sets_without_changing_game_metrics(api):
    api.create_admin()
    admin = api.client()
    api.login(admin, "admin", "admin-password")
    ids = []
    for index in range(8):
        response = admin.post(
            "/api/v1/admin/players",
            json={
                "username": f"set-player-{index}",
                "password": "player-password",
                "gender": "M",
                "club_rank": 3,
            },
        )
        assert response.status_code == 201, response.text
        ids.append(response.json()["id"])
    response = admin.post(
        "/api/v1/admin/competitions",
        json={
            "name": "승리 세트 집계",
            "type": "team",
            "teams": [{"name": "A", "member_ids": ids[:4]}, {"name": "B", "member_ids": ids[4:]}],
        },
    )
    assert response.status_code == 201, response.text
    competition = response.json()
    path = f"/api/v1/admin/competitions/{competition['id']}"
    encounter = competition["encounters"][0]
    team1_id, team2_id = encounter["team1"]["id"], encounter["team2"]["id"]
    for index, (score1, score2) in enumerate([(1, 2), (3, 0), (2, 1), (0, 3)]):
        response = admin.post(
            f"{path}/team-encounters/{encounter['id']}/singles",
            json={
                "team1_player_id": ids[index],
                "team2_player_id": ids[4 + index],
                "score1": score1,
                "score2": score2,
            },
        )
        assert response.status_code == 200, response.text
        if index == 0:
            rows = admin.get(path).json()["standings"]
            by_id = {row["team"]["id"]: row for row in rows}
            assert by_id[team1_id]["sets_won"] == 1
            assert by_id[team2_id]["sets_won"] == 2
            assert [row["team"]["id"] for row in rows] == [team2_id, team1_id]
            assert all(
                row["played"] == row["wins"] == row["games_won"] == row["games_lost"] == 0
                for row in rows
            )
    # 2:2 awaits doubles: all six won sets count but no team win is awarded yet.
    pending = admin.get(path).json()
    assert pending["status"] == "active"
    assert all(
        row["sets_won"] == 6 and row["played"] == row["wins"] == 0 for row in pending["standings"]
    )
    response = admin.put(
        f"{path}/team-encounters/{encounter['id']}/doubles", json={"score1": 1, "score2": 2}
    )
    assert response.status_code == 200, response.text
    by_id = {row["team"]["id"]: row for row in admin.get(path).json()["standings"]}
    assert by_id[team1_id]["sets_won"] == 7
    assert by_id[team2_id]["sets_won"] == 8
    assert (
        by_id[team1_id]["games_won"],
        by_id[team1_id]["games_lost"],
        by_id[team1_id]["game_difference"],
    ) == (2, 3, -1)
    assert by_id[team2_id]["wins"] == 1
    assert by_id[team1_id]["wins"] == 0
