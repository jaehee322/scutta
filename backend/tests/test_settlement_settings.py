from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.schemas.stats import RankingCategory


def _create_player(admin_client, username: str = "선수") -> None:
    response = admin_client.post(
        "/api/v1/admin/players",
        json={
            "username": username,
            "password": "player-password",
            "gender": "M",
            "is_freshman": False,
            "club_rank": 4,
        },
    )
    assert response.status_code == 201, response.text


def test_admin_can_persist_settlement_settings_and_players_receive_them(api) -> None:
    api.create_admin()
    admin_client = api.client()
    api.login(admin_client, "admin", "admin-password")

    configured = get_settings()
    initial = admin_client.get("/api/v1/admin/settlements/settings")
    assert initial.status_code == 200, initial.text
    assert initial.json() == {
        "prizes": {
            category.value: configured.settlement_prizes.get(category.value, "")
            for category in RankingCategory
        },
    }

    updated = admin_client.patch(
        "/api/v1/admin/settlements/settings",
        json={
            "prizes": {"wins": "  우승 상품권  "},
        },
    )
    assert updated.status_code == 200, updated.text
    updated_body = updated.json()
    assert updated_body["prizes"]["wins"] == "우승 상품권"
    assert updated_body["prizes"]["matches"] == configured.settlement_prizes["matches"]

    # A separate request/session sees the database-backed values as well.
    second_admin_client = api.client()
    api.login(second_admin_client, "admin", "admin-password")
    assert second_admin_client.get("/api/v1/admin/settlements/settings").json() == updated_body

    _create_player(admin_client)
    player_client = api.client()
    api.login(player_client, "선수", "player-password")
    settlement = player_client.get("/api/v1/settlements")
    assert settlement.status_code == 200, settlement.text
    assert settlement.json()["draws"] == configured.settlement_draws
    assert [item["category"] for item in settlement.json()["categories"]] == [
        "matches",
        "wins",
        "losses",
    ]
    wins = next(
        category
        for category in settlement.json()["categories"]
        if category["category"] == "wins"
    )
    assert wins["prize"] == "우승 상품권"
    assert player_client.get("/api/v1/admin/settlements/settings").status_code == 403


def test_settlement_settings_require_admin(api) -> None:
    anonymous = api.client()
    assert anonymous.get("/api/v1/admin/settlements/settings").status_code == 401
    assert (
        anonymous.patch(
            "/api/v1/admin/settlements/settings",
            json={"prizes": {"matches": "상품"}},
        ).status_code
        == 401
    )


def test_settlement_openapi_only_exposes_supported_categories(api) -> None:
    schema = api.client().get("/openapi.json").json()
    assert schema["components"]["schemas"]["SettlementCategoryKey"]["enum"] == [
        "matches",
        "wins",
        "losses",
    ]


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"prizes": {}},
        {"prizes": {"matches": "   "}},
        {"prizes": None},
    ],
)
def test_settlement_settings_reject_invalid_updates(api, payload: dict) -> None:
    api.create_admin()
    admin_client = api.client()
    api.login(admin_client, "admin", "admin-password")

    response = admin_client.patch("/api/v1/admin/settlements/settings", json=payload)
    assert response.status_code == 422, response.text
