from __future__ import annotations

from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from app.models import Match, MatchKind

TODAY = date(2026, 9, 13)


@pytest.fixture
def scope_setup(api, monkeypatch):
    monkeypatch.setattr(
        "app.services.matches.seoul_now",
        lambda: datetime(2026, 9, 13, 12, tzinfo=ZoneInfo("Asia/Seoul")),
    )
    api.create_admin()
    admin = api.client()
    api.login(admin, "admin", "admin-password")
    players = []
    for index in range(8):
        response = admin.post(
            "/api/v1/admin/players",
            json={
                "username": f"scope-player-{index}",
                "password": "player-password",
                "gender": "M",
                "club_rank": 3,
            },
        )
        assert response.status_code == 201, response.text
        players.append(response.json())
    pair = [players[0], players[4]]
    clients = []
    for player in pair:
        client = api.client()
        api.login(client, player["username"], "player-password")
        clients.append(client)
    return admin, players, pair, clients


def _event(admin, players, kind, name="대회"):
    body = {"name": name, "type": kind}
    if kind == "league":
        body["participant_ids"] = [players[i]["id"] for i in (0, 4, 1, 5)]
    else:
        body["teams"] = [
            {"name": "A", "member_ids": [p["id"] for p in players[:4]]},
            {"name": "B", "member_ids": [p["id"] for p in players[4:]]},
        ]
    response = admin.post("/api/v1/admin/competitions", json=body)
    assert response.status_code == 201, response.text
    detail = response.json()
    if kind == "league":
        target = next(
            row
            for row in detail["fixtures"]
            if {row["player1"]["id"], row["player2"]["id"]} == {players[0]["id"], players[4]["id"]}
        )
    else:
        target = detail["encounters"][0]
    return {
        "id": detail["id"],
        "kind": kind,
        "target": target,
        "first": players[0]["id"],
        "second": players[4]["id"],
    }


def _player_result(client, event, actor, opponent):
    prefix = f"/api/v1/competitions/{event['id']}"
    if event["kind"] == "league":
        return client.post(
            f"{prefix}/league-fixtures/{event['target']['id']}/result",
            json={"my_score": 2, "opponent_score": 1},
        )
    return client.post(
        f"{prefix}/team-encounters/{event['target']['id']}/singles",
        json={
            "my_team_player_id": actor["id"],
            "opponent_team_player_id": opponent["id"],
            "my_team_score": 2,
            "opponent_team_score": 1,
        },
    )


def _admin_result(admin, event, *, played_on=TODAY, single_id=None):
    prefix = f"/api/v1/admin/competitions/{event['id']}"
    body = {"score1": 1, "score2": 2, "played_on": played_on.isoformat()}
    if event["kind"] == "league":
        return admin.put(f"{prefix}/league-fixtures/{event['target']['id']}/result", json=body)
    body.update(team1_player_id=event["first"], team2_player_id=event["second"])
    if single_id is not None:
        return admin.put(f"{prefix}/team-singles/{single_id}", json=body)
    return admin.post(f"{prefix}/team-encounters/{event['target']['id']}/singles", json=body)


def _casual(client, opponent):
    return client.post(
        "/api/v1/matches",
        json={
            "opponent_id": opponent["id"],
            "my_score": 0,
            "opponent_score": 3,
        },
    )


@pytest.mark.parametrize("kind", ["league", "team"])
@pytest.mark.parametrize("competition_first", [False, True])
@pytest.mark.parametrize("actor_side", [0, 1])
def test_player_competition_and_casual_overlap_in_both_orders_and_perspectives(
    scope_setup, kind, competition_first, actor_side
):
    admin, players, pair, clients = scope_setup
    event = _event(admin, players, kind)
    actor, opponent = pair[actor_side], pair[1 - actor_side]
    client = clients[actor_side]
    actions = [
        lambda: _player_result(client, event, actor, opponent),
        lambda: _casual(client, opponent),
    ]
    if not competition_first:
        actions.reverse()
    for action in actions:
        response = action()
        assert response.status_code in (200, 201), response.text
    assert _player_result(client, event, actor, opponent).status_code == 409
    assert _casual(client, opponent).status_code == 409
    assert _casual(clients[1 - actor_side], actor).status_code == 409
    assert client.get("/api/v1/players/me").json()["stats"] == {
        "matches": 2,
        "wins": 1,
        "losses": 1,
        "opponents": 1,
    }
    history = client.get("/api/v1/matches").json()
    assert history["total"] == 2
    assert {row["kind"] for row in history["items"]} == {"casual", "competition"}
    assert {row["played_on"] for row in history["items"]} == {TODAY.isoformat()}
    rankings = client.get("/api/v1/rankings").json()
    for category, value in (("matches", 2), ("wins", 1), ("losses", 1)):
        entries = next(row for row in rankings["categories"] if row["category"] == category)[
            "entries"
        ]
        assert next(row for row in entries if row["player"]["id"] == actor["id"])["value"] == value
    settlement = client.get("/api/v1/settlements").json()
    assert {row["category"]: row["value"] for row in settlement["categories"]} == {
        "matches": 2,
        "wins": 1,
        "losses": 1,
    }


@pytest.mark.parametrize("kinds", [("league", "league"), ("team", "team"), ("league", "team")])
def test_same_pair_can_play_in_two_competitions_and_one_casual_match(scope_setup, kinds):
    admin, players, pair, clients = scope_setup
    first = _event(admin, players, kinds[0], "첫 대회")
    second = _event(admin, players, kinds[1], "둘째 대회")
    first_result = _player_result(clients[0], first, pair[0], pair[1])
    assert first_result.status_code == 200, first_result.text
    second_result = _admin_result(admin, second)
    assert second_result.status_code == 200, second_result.text
    casual = _casual(clients[0], pair[1])
    assert casual.status_code == 201, casual.text
    history = clients[0].get("/api/v1/matches").json()
    assert history["total"] == 3
    assert sum(row["kind"] == "competition" for row in history["items"]) == 2
    assert clients[0].get("/api/v1/players/me").json()["stats"] == {
        "matches": 3,
        "wins": 1,
        "losses": 2,
        "opponents": 1,
    }
    # Relaxing the cross-competition limit does not permit duplicate participation.
    assert _player_result(clients[1], second, pair[1], pair[0]).status_code == 409


@pytest.mark.parametrize("kind", ["league", "team"])
def test_admin_can_move_competition_and_casual_dates_together_but_not_two_casuals(
    scope_setup, kind
):
    admin, players, pair, clients = scope_setup
    event = _event(admin, players, kind)
    casual = _casual(clients[0], pair[1])
    assert casual.status_code == 201, casual.text
    casual_id = casual.json()["id"]
    created = _admin_result(admin, event, played_on=TODAY - timedelta(days=1))
    assert created.status_code == 200, created.text
    single_id = created.json()["singles"][0]["id"] if kind == "team" else None
    moved = _admin_result(admin, event, played_on=TODAY, single_id=single_id)
    assert moved.status_code == 200, moved.text
    old_day = (TODAY - timedelta(days=2)).isoformat()
    assert (
        admin.patch(f"/api/v1/admin/matches/{casual_id}", json={"played_on": old_day}).status_code
        == 200
    )
    # A normal result can also be moved onto the competition's date.
    restored = admin.patch(
        f"/api/v1/admin/matches/{casual_id}", json={"played_on": TODAY.isoformat()}
    )
    assert restored.status_code == 200, restored.text
    assert (
        admin.patch(f"/api/v1/admin/matches/{casual_id}", json={"played_on": old_day}).status_code
        == 200
    )
    second_casual = _casual(clients[1], pair[0])
    assert second_casual.status_code == 201, second_casual.text
    blocked = admin.patch(
        f"/api/v1/admin/matches/{casual_id}", json={"played_on": TODAY.isoformat()}
    )
    assert blocked.status_code == 409
    normal_rows = admin.get("/api/v1/admin/matches").json()
    assert normal_rows["total"] == 2
    assert (
        next(row for row in normal_rows["items"] if row["id"] == casual_id)["played_on"] == old_day
    )
    assert clients[0].get("/api/v1/matches").json()["total"] == 3


@pytest.mark.parametrize("ordinary_kind", [MatchKind.CASUAL, MatchKind.DAILY])
def test_legacy_daily_and_casual_rows_still_block_only_ordinary_submissions(
    api, scope_setup, ordinary_kind
):
    admin, players, pair, clients = scope_setup
    with api.session_factory() as db:
        db.add(
            Match(
                player1_id=pair[0]["id"],
                player2_id=pair[1]["id"],
                score1=3,
                score2=0,
                kind=ordinary_kind,
                played_on=TODAY,
            )
        )
        db.commit()
    assert _casual(clients[0], pair[1]).status_code == 409
    assert _casual(clients[1], pair[0]).status_code == 409
    event = _event(admin, players, "league")
    submitted = _admin_result(admin, event)
    assert submitted.status_code == 200, submitted.text
    assert clients[0].get("/api/v1/matches").json()["total"] == 2
