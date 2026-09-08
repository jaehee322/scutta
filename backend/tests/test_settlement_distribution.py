from __future__ import annotations

from datetime import date, timedelta

import pytest

from app.core.security import hash_password
from app.models import Gender, Match, SettlementSettings, User, UserRole

PLAYER_PASSWORD = "distribution-test-password"
SUMMARY_FIELDS = {"category", "prize", "value", "tickets", "total_tickets", "probability_percent"}
ENTRY_FIELDS = {"player_id", "username", "tickets", "probability_percent", "rank"}


def _create_players(api, names: list[str]) -> list[User]:
    password_hash = hash_password(PLAYER_PASSWORD)
    with api.session_factory() as db:
        players = [
            User(
                username=name,
                password_hash=password_hash,
                role=UserRole.PLAYER,
                gender=Gender.MALE,
                club_rank=4,
            )
            for name in names
        ]
        db.add_all(players)
        db.commit()
        return players


def _add_alternating_matches(db, first: User, second: User, count: int) -> None:
    for day in range(count):
        db.add(
            Match(
                player1_id=first.id,
                player2_id=second.id,
                score1=3 if day % 2 == 0 else 0,
                score2=0 if day % 2 == 0 else 3,
                played_on=date(2026, 1, 1) + timedelta(days=day),
            )
        )


@pytest.fixture
def large_distribution(api):
    first_admin = api.create_admin()
    second_admin = api.create_admin(username="second-admin")
    # The first two names casefold identically, so their ids must break the tie.
    names = ["alpha", "ALPHA", "Zulu", "bravo"] + [f"회원{index:03}" for index in range(4, 80)]
    players = _create_players(api, names)
    with api.session_factory() as db:
        for index in range(0, 50, 2):
            _add_alternating_matches(
                db, players[index], players[index + 1], 40 if index == 0 else 20
            )
        # Their partial counts must never be pooled into an additional ticket.
        _add_alternating_matches(db, players[50], players[51], 9)
        # Even historical administrator match records cannot add holders or tickets.
        _add_alternating_matches(db, first_admin, second_admin, 20)
        db.add(
            SettlementSettings(
                id=1,
                matches_prize="경기 상품",
                wins_prize="승리 상품",
                losses_prize="패배 상품",
            )
        )
        db.commit()
    return players, {first_admin.id, second_admin.id}


@pytest.mark.parametrize(
    ("category", "prize", "my_value", "holder_value", "top_tickets", "other_tickets", "total"),
    [
        ("matches", "경기 상품", 9, 40, 4, 2, 104),
        ("wins", "승리 상품", 5, 20, 2, 1, 52),
        ("losses", "패배 상품", 4, 20, 2, 1, 52),
    ],
)
def test_distribution_returns_all_fifty_holders_with_stable_ties_and_matching_summaries(
    api,
    large_distribution,
    category,
    prize,
    my_value,
    holder_value,
    top_tickets,
    other_tickets,
    total,
) -> None:
    players, admin_ids = large_distribution
    no_tickets_client = api.client()
    api.login(no_tickets_client, players[50].username, PLAYER_PASSWORD)
    assert len(no_tickets_client.get("/api/v1/players").json()) == 80
    path = f"/api/v1/settlements/{category}/distribution"
    response = no_tickets_client.get(path)
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == SUMMARY_FIELDS | {"holder_count", "entries"}
    assert {key: body[key] for key in SUMMARY_FIELDS} == {
        "category": category,
        "prize": prize,
        "value": my_value,
        "tickets": 0,
        "total_tickets": total,
        "probability_percent": 0.0,
    }
    assert body["holder_count"] == len(body["entries"]) == 50
    assert {entry["player_id"] for entry in body["entries"]} == {
        player.id for player in players[:50]
    }
    assert admin_ids.isdisjoint(entry["player_id"] for entry in body["entries"])
    assert all(set(entry) == ENTRY_FIELDS for entry in body["entries"])
    assert sum(entry["tickets"] for entry in body["entries"]) == total
    assert [entry["username"] for entry in body["entries"][:4]] == [
        "alpha",
        "ALPHA",
        "bravo",
        "Zulu",
    ]
    assert [entry["rank"] for entry in body["entries"]] == [1, 1] + [3] * 48
    assert [entry["tickets"] for entry in body["entries"]] == [top_tickets] * 2 + [
        other_tickets
    ] * 48
    assert all(entry["probability_percent"] == 3.85 for entry in body["entries"][:2])
    assert all(entry["probability_percent"] == 1.92 for entry in body["entries"][2:])

    existing = no_tickets_client.get("/api/v1/settlements").json()
    assert set(existing) == {"draws", "categories"}
    category_summary = next(item for item in existing["categories"] if item["category"] == category)
    assert category_summary == {key: body[key] for key in SUMMARY_FIELDS}

    holder_client = api.client()
    api.login(holder_client, players[0].username, PLAYER_PASSWORD)
    holder_body = holder_client.get(path).json()
    assert holder_body["entries"] == body["entries"]
    assert holder_body["holder_count"] == body["holder_count"]
    assert holder_body["total_tickets"] == body["total_tickets"]
    assert (holder_body["value"], holder_body["tickets"], holder_body["probability_percent"]) == (
        holder_value,
        top_tickets,
        3.85,
    )
    holder_summary = next(
        item
        for item in holder_client.get("/api/v1/settlements").json()["categories"]
        if item["category"] == category
    )
    assert holder_summary == {key: holder_body[key] for key in SUMMARY_FIELDS}
    # Repeated reads keep the snapshot order and counts stable.
    assert no_tickets_client.get(path).json() == body


def test_distribution_with_no_tickets_keeps_values_and_zero_probabilities(api) -> None:
    api.create_admin()
    players = _create_players(api, ["조금참여", "다른선수", "미참여"])
    with api.session_factory() as db:
        _add_alternating_matches(db, players[0], players[1], 9)
        db.commit()
    for player, expected_values in ((players[0], (9, 5, 4)), (players[2], (0, 0, 0))):
        client = api.client()
        api.login(client, player.username, PLAYER_PASSWORD)
        for category, value in zip(("matches", "wins", "losses"), expected_values, strict=True):
            response = client.get(f"/api/v1/settlements/{category}/distribution")
            assert response.status_code == 200, response.text
            body = response.json()
            assert body["value"] == value
            assert body["tickets"] == body["total_tickets"] == body["holder_count"] == 0
            assert body["probability_percent"] == 0.0
            assert body["entries"] == []


def test_distribution_requires_player_auth_and_supported_category(api) -> None:
    api.create_admin()
    player = _create_players(api, ["권한확인"])[0]
    path = "/api/v1/settlements/matches/distribution"
    assert api.client().get(path).status_code == 401
    admin = api.client()
    api.login(admin, "admin", "admin-password")
    assert admin.get(path).status_code == 403
    client = api.client()
    api.login(client, player.username, PLAYER_PASSWORD)
    for category in ("opponents", "unknown", "MATCHES"):
        assert client.get(f"/api/v1/settlements/{category}/distribution").status_code == 422
