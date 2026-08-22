from __future__ import annotations

from sqlalchemy import func, select

from app.models import AuthSession, Competition, Match, User


def _admin(api):
    api.create_admin()
    client = api.client()
    api.login(client, "admin", "admin-password")
    return client


def _create_player(admin, username: str) -> dict:
    response = admin.post(
        "/api/v1/admin/players",
        json={
            "username": username,
            "password": "20260000",
            "gender": "M",
            "is_freshman": False,
            "club_rank": 5,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_delete_unused_player_requires_admin_and_revokes_sessions(api) -> None:
    admin = _admin(api)
    player = _create_player(admin, "삭제대상")
    player_client = api.client()
    api.login(player_client, player["username"], "20260000")
    url = f"/api/v1/admin/players/{player['id']}"

    assert api.client().delete(url).status_code == 401
    assert player_client.delete(url).status_code == 403
    assert admin.delete("/api/v1/admin/players/999999").status_code == 404

    deleted = admin.delete(url)
    assert deleted.status_code == 204
    assert deleted.content == b""
    assert player_client.get("/api/v1/auth/me").status_code == 401
    assert all(item["id"] != player["id"] for item in admin.get("/api/v1/admin/players").json())
    assert (
        api.client()
        .post(
            "/api/v1/auth/login",
            json={"username": player["username"], "password": "20260000"},
        )
        .status_code
        == 401
    )

    with api.session_factory() as db:
        assert db.get(User, player["id"]) is None
        assert (
            db.scalar(
                select(func.count())
                .select_from(AuthSession)
                .where(AuthSession.user_id == player["id"])
            )
            == 0
        )


def test_delete_player_with_match_is_rejected_without_data_loss(api) -> None:
    admin = _admin(api)
    player_a = _create_player(admin, "경기선수A")
    player_b = _create_player(admin, "경기선수B")
    player_client = api.client()
    api.login(player_client, player_a["username"], "20260000")
    match = player_client.post(
        "/api/v1/matches",
        json={"opponent_id": player_b["id"], "my_score": 3, "opponent_score": 0},
    )
    assert match.status_code == 201, match.text

    response = admin.delete(f"/api/v1/admin/players/{player_a['id']}")
    assert response.status_code == 409
    assert response.json()["detail"] == (
        "경기 또는 대회 기록이 있는 선수는 삭제할 수 없습니다. 연결된 기록을 먼저 삭제해 주세요."
    )

    with api.session_factory() as db:
        assert db.get(User, player_a["id"]) is not None
        assert db.get(User, player_b["id"]) is not None
        assert db.scalar(select(func.count()).select_from(Match)) == 1


def test_delete_player_in_competition_is_rejected_without_data_loss(api) -> None:
    admin = _admin(api)
    players = [_create_player(admin, f"리그선수{index}") for index in range(1, 5)]
    created = admin.post(
        "/api/v1/admin/competitions",
        json={
            "name": "삭제 보호 리그",
            "type": "league",
            "participant_ids": [player["id"] for player in players],
        },
    )
    assert created.status_code == 201, created.text

    response = admin.delete(f"/api/v1/admin/players/{players[0]['id']}")
    assert response.status_code == 409

    with api.session_factory() as db:
        assert db.get(User, players[0]["id"]) is not None
        assert db.scalar(select(func.count()).select_from(Competition)) == 1
        assert db.scalar(select(func.count()).select_from(User)) == 5
