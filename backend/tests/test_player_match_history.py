from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest

from app.core.security import hash_password
from app.models import Competition, CompetitionType, Gender, Match, MatchKind, User, UserRole


@pytest.fixture
def history_data(api):
    admin_user = api.create_admin()
    password = "history-test-password"
    password_hash = hash_password(password)
    with api.session_factory() as db:
        players = [
            User(
                username=name,
                password_hash=password_hash,
                role=UserRole.PLAYER,
                gender=Gender.MALE,
                club_rank=4,
            )
            for name in ("A", "B", "C", "D", "E")
        ]
        db.add_all(players)
        db.flush()
        users = {player.username: player.id for player in players}
        users["admin"] = admin_user.id
        competition = Competition(name="기록 테스트 리그", type=CompetitionType.LEAGUE)
        db.add(competition)
        db.flush()
        # B has four wins and three losses, including a league win and a legacy
        # daily loss. A versus B has one A win and two A losses.
        pair_scores = [
            ("A", "B", 3, 0, MatchKind.CASUAL),
            ("B", "C", 3, 0, MatchKind.CASUAL),
            ("A", "B", 0, 3, MatchKind.COMPETITION),
            ("B", "C", 1, 2, MatchKind.DAILY),
            ("A", "B", 0, 3, MatchKind.CASUAL),
            ("B", "C", 3, 0, MatchKind.CASUAL),
            ("B", "C", 1, 2, MatchKind.CASUAL),
        ]
        records = []
        for index, (first, second, score1, score2, kind) in enumerate(pair_scores):
            record = Match(
                player1_id=users[first],
                player2_id=users[second],
                score1=score1,
                score2=score2,
                kind=kind,
                competition_id=competition.id if kind == MatchKind.COMPETITION else None,
                played_on=date(2026, 9, index + 1),
                played_at=datetime(2026, 9, index + 1, 1, 0, tzinfo=UTC),
            )
            db.add(record)
            records.append(record)
        # This more recent match must not leak into B's complete or head-to-head history.
        db.add(
            Match(
                player1_id=users["A"],
                player2_id=users["C"],
                score1=3,
                score2=0,
                kind=MatchKind.CASUAL,
                played_on=date(2026, 9, 8),
            )
        )
        db.commit()
        record_ids = [record.id for record in records]

    client = api.client()
    api.login(client, "A", password)
    return users, client, record_ids


def test_player_history_pages_all_kinds_and_aggregates_the_complete_filter(history_data) -> None:
    users, client, ids = history_data
    path = f"/api/v1/players/{users['B']}/matches"
    first = client.get(path)
    assert first.status_code == 200, first.text
    body = first.json()
    assert {key: body[key] for key in ("total", "limit", "offset", "wins", "losses")} == {
        "total": 7,
        "limit": 5,
        "offset": 0,
        "wins": 4,
        "losses": 3,
    }
    assert [item["id"] for item in body["items"]] == list(reversed(ids[2:]))
    assert {item["kind"] for item in body["items"]} == {"casual", "daily", "competition"}
    assert body["items"][0]["player1"] == {"id": users["B"], "username": "B"}
    assert body["items"][0]["player2"] == {"id": users["C"], "username": "C"}
    assert body["items"][0]["winner_id"] == users["C"]
    assert body["items"][0]["loser_id"] == users["B"]
    assert datetime.fromisoformat(body["items"][0]["played_at"]).utcoffset() == timedelta(hours=9)

    next_page = client.get(path, params={"limit": 5, "offset": 5}).json()
    assert [item["id"] for item in next_page["items"]] == list(reversed(ids[:2]))
    assert next_page["offset"] == 5
    assert (next_page["total"], next_page["wins"], next_page["losses"]) == (7, 4, 3)
    beyond = client.get(path, params={"limit": 5, "offset": 20}).json()
    assert beyond == {"items": [], "total": 7, "limit": 5, "offset": 20, "wins": 4, "losses": 3}

    # The existing rankings use the same complete set of regular and league matches.
    rankings = client.get("/api/v1/rankings").json()["categories"]
    values = {
        category["category"]: next(
            row["value"] for row in category["entries"] if row["player"]["id"] == users["B"]
        )
        for category in rankings
    }
    assert (values["matches"], values["wins"], values["losses"]) == (7, 4, 3)


def test_head_to_head_filters_both_players_and_uses_the_viewers_perspective(
    api, history_data
) -> None:
    users, client_a, ids = history_data
    response = client_a.get(
        f"/api/v1/players/{users['B']}/matches",
        params={"head_to_head": "true", "limit": 1, "offset": 1},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert [item["id"] for item in body["items"]] == [ids[2]]
    assert (body["total"], body["wins"], body["losses"]) == (3, 1, 2)

    client_b = api.client()
    api.login(client_b, "B", "history-test-password")
    reverse = client_b.get(
        f"/api/v1/players/{users['A']}/matches", params={"head_to_head": "true"}
    ).json()
    assert [item["id"] for item in reverse["items"]] == [ids[4], ids[2], ids[0]]
    assert (reverse["total"], reverse["wins"], reverse["losses"]) == (3, 2, 1)
    assert reverse["items"][0]["player2"]["id"] == users["B"]


def test_empty_player_and_self_head_to_head_have_zero_totals(history_data) -> None:
    users, client, _ = history_data
    for player_id, head_to_head in ((users["D"], False), (users["D"], True), (users["A"], True)):
        response = client.get(
            f"/api/v1/players/{player_id}/matches", params={"head_to_head": head_to_head}
        )
        assert response.status_code == 200, response.text
        assert response.json() == {
            "items": [],
            "total": 0,
            "limit": 5,
            "offset": 0,
            "wins": 0,
            "losses": 0,
        }


def test_player_history_keeps_existing_my_matches_contract(api, history_data) -> None:
    users, client, _ = history_data
    previous = client.get("/api/v1/matches").json()
    current = client.get(f"/api/v1/players/{users['A']}/matches", params={"limit": 50}).json()
    assert set(previous) == {"items", "total", "limit", "offset"}
    assert previous["limit"] == 50
    assert {key: current[key] for key in previous} == previous
    mine = client.get("/api/v1/players/me").json()["stats"]
    assert (current["total"], current["wins"], current["losses"]) == (
        mine["matches"],
        mine["wins"],
        mine["losses"],
    )
    assert client.get("/api/v1/players").status_code == 200


def test_player_history_requires_player_auth_and_valid_target_and_pagination(
    api, history_data
) -> None:
    users, client, _ = history_data
    path = f"/api/v1/players/{users['B']}/matches"
    assert api.client().get(path).status_code == 401
    admin = api.client()
    api.login(admin, "admin", "admin-password")
    assert admin.get(path).status_code == 403
    for player_id in (users["admin"], 0, 999_999):
        for head_to_head in (False, True):
            assert (
                client.get(
                    f"/api/v1/players/{player_id}/matches", params={"head_to_head": head_to_head}
                ).status_code
                == 404
            )
    for params in ({"limit": 0}, {"limit": 201}, {"offset": -1}, {"head_to_head": "unknown"}):
        assert client.get(path, params=params).status_code == 422
    assert client.get(path, params={"limit": 200}).status_code == 200


def test_player_history_sorts_date_then_known_time_then_descending_id(api, history_data) -> None:
    users, client, _ = history_data
    same_day = date(2026, 9, 12)
    with api.session_factory() as db:
        records = []
        for opponent, hour in (("A", None), ("C", 10), ("D", 10), ("E", 9)):
            record = Match(
                player1_id=min(users["B"], users[opponent]),
                player2_id=max(users["B"], users[opponent]),
                score1=3,
                score2=0,
                played_on=same_day,
                played_at=datetime(2026, 9, 12, hour, 0, tzinfo=UTC) if hour is not None else None,
            )
            db.add(record)
            records.append(record)
        next_day = Match(
            player1_id=users["A"],
            player2_id=users["B"],
            score1=3,
            score2=0,
            played_on=same_day + timedelta(days=1),
            played_at=None,
        )
        db.add(next_day)
        db.commit()
        expected_ids = [next_day.id, records[2].id, records[1].id, records[3].id, records[0].id]
    response = client.get(f"/api/v1/players/{users['B']}/matches")
    assert response.status_code == 200, response.text
    assert [item["id"] for item in response.json()["items"]] == expected_ids
    assert response.json()["items"][0]["played_at"] is None
    assert response.json()["items"][-1]["played_at"] is None
