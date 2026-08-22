from __future__ import annotations

from datetime import timedelta

from sqlalchemy import func, select

from app.models import (
    AuthSession,
    Competition,
    CompetitionMember,
    CompetitionStatus,
    CompetitionType,
    Match,
    MatchKind,
    User,
    UserRole,
)
from app.services.matches import seoul_today


def _create_player(
    admin_client,
    username: str,
    password: str = "20260000",
    *,
    gender: str = "M",
) -> dict:
    response = admin_client.post(
        "/api/v1/admin/players",
        json={
            "username": username,
            "password": password,
            "gender": gender,
            "is_freshman": False,
            "club_rank": 5,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


def _category(response: dict, category: str) -> dict:
    return next(item for item in response["categories"] if item["category"] == category)


def test_auth_and_admin_player_management(api) -> None:
    api.create_admin()
    anonymous = api.client()
    assert anonymous.get("/health").json() == {"status": "ok"}
    health_head = anonymous.head("/health")
    assert health_head.status_code == 200
    assert health_head.content == b""
    assert anonymous.get("/api/v1/auth/me").status_code == 401

    admin_client = api.client()
    api.login(admin_client, "admin", "admin-password")
    cookie = admin_client.cookies.get("scutta_session")
    assert cookie

    player = _create_player(admin_client, "홍길동", "20261234", gender="F")
    assert player["username"] == "홍길동"
    assert player["role"] == "player"
    assert "is_active" not in player

    duplicate = admin_client.post(
        "/api/v1/admin/players",
        json={
            "username": "홍길동",
            "password": "99999999",
            "gender": "F",
            "club_rank": 5,
        },
    )
    assert duplicate.status_code == 409

    player_client = api.client()
    api.login(player_client, "홍길동", "20261234")
    second_session = api.client()
    api.login(second_session, "홍길동", "20261234")

    changed = player_client.patch(
        "/api/v1/auth/password",
        json={"current_password": "20261234", "new_password": "new-password"},
    )
    assert changed.status_code == 200
    assert player_client.get("/api/v1/auth/me").status_code == 200
    assert second_session.get("/api/v1/auth/me").status_code == 401

    stale_login = api.client().post(
        "/api/v1/auth/login",
        json={"username": "홍길동", "password": "20261234"},
    )
    assert stale_login.status_code == 401

    reset = admin_client.post(
        f"/api/v1/admin/players/{player['id']}/password-reset",
        json={"new_password": "reset-password"},
    )
    assert reset.status_code == 200
    assert player_client.get("/api/v1/auth/me").status_code == 401
    api.login(api.client(), "홍길동", "reset-password")

    updated = admin_client.patch(
        f"/api/v1/admin/players/{player['id']}",
        json={"username": "홍길동2", "club_rank": 6},
    )
    assert updated.status_code == 200
    assert updated.json()["username"] == "홍길동2"
    assert updated.json()["club_rank"] == 6
    assert "is_active" not in updated.json()


def test_matches_rankings_settlement_and_admin_edits(api) -> None:
    api.create_admin()
    admin_client = api.client()
    api.login(admin_client, "admin", "admin-password")
    player_a = _create_player(admin_client, "A")
    player_b = _create_player(admin_client, "B")
    player_c = _create_player(admin_client, "C")

    client_a = api.client()
    api.login(client_a, "A", "20260000")
    submitted = client_a.post(
        "/api/v1/matches",
        json={"opponent_id": player_b["id"], "my_score": 3, "opponent_score": 0},
    )
    assert submitted.status_code == 201, submitted.text
    match_id = submitted.json()["id"]
    assert submitted.json()["winner_id"] == player_a["id"]
    assert (
        admin_client.patch(
            f"/api/v1/admin/matches/{match_id}",
            json={"kind": "competition"},
        ).status_code
        == 422
    )

    assert (
        client_a.post(
            "/api/v1/matches",
            json={"opponent_id": player_b["id"], "my_score": 2, "opponent_score": 1},
        ).status_code
        == 409
    )
    client_b = api.client()
    api.login(client_b, "B", "20260000")
    assert (
        client_b.post(
            "/api/v1/matches",
            json={"opponent_id": player_a["id"], "my_score": 2, "opponent_score": 1},
        ).status_code
        == 409
    )
    assert (
        client_a.post(
            "/api/v1/matches",
            json={"opponent_id": player_c["id"], "my_score": 3, "opponent_score": 1},
        ).status_code
        == 422
    )

    with api.session_factory() as db:
        for days_ago in range(1, 20):
            db.add(
                Match(
                    player1_id=min(player_a["id"], player_b["id"]),
                    player2_id=max(player_a["id"], player_b["id"]),
                    score1=3,
                    score2=0,
                    kind=MatchKind.CASUAL,
                    played_on=seoul_today() - timedelta(days=days_ago),
                    submitted_by_id=player_a["id"],
                )
            )
        db.commit()

    rankings = client_a.get("/api/v1/rankings")
    assert rankings.status_code == 200, rankings.text
    match_ranking = _category(rankings.json(), "matches")["entries"]
    match_positions = [
        (item["player"]["username"], item["rank"], item["value"]) for item in match_ranking
    ]
    assert match_positions == [
        ("A", 1, 20),
        ("B", 1, 20),
        ("C", 3, 0),
    ]
    loss_ranking = _category(rankings.json(), "losses")["entries"]
    assert loss_ranking[0]["player"]["username"] == "B"
    assert loss_ranking[0]["value"] == 20

    settlement = client_a.get("/api/v1/settlements")
    assert settlement.status_code == 200
    matches_settlement = _category(settlement.json(), "matches")
    assert matches_settlement == {
        "category": "matches",
        "prize": "경기 수 부문 상품",
        "value": 20,
        "tickets": 2,
        "total_tickets": 4,
        "probability_percent": 50.0,
    }
    wins_settlement = _category(settlement.json(), "wins")
    assert wins_settlement["tickets"] == 2
    assert wins_settlement["probability_percent"] == 100.0

    patched = admin_client.patch(
        f"/api/v1/admin/matches/{match_id}",
        json={"score1": 0, "score2": 3},
    )
    assert patched.status_code == 200, patched.text
    assert patched.json()["winner_id"] == player_b["id"]
    my_stats = client_a.get("/api/v1/players/me").json()["stats"]
    assert my_stats == {"matches": 20, "wins": 19, "losses": 1, "opponents": 1}

    deleted = admin_client.delete(f"/api/v1/admin/matches/{match_id}")
    assert deleted.status_code == 204
    assert client_a.get("/api/v1/players/me").json()["stats"]["matches"] == 19


def test_full_semester_reset_preserves_admin(api) -> None:
    admin = api.create_admin()
    admin_client = api.client()
    api.login(admin_client, "admin", "admin-password")
    player_a = _create_player(admin_client, "A")
    player_b = _create_player(admin_client, "B")
    player_client = api.client()
    api.login(player_client, "A", "20260000")

    with api.session_factory() as db:
        competition = Competition(
            name="테스트 리그",
            type=CompetitionType.LEAGUE,
            status=CompetitionStatus.ACTIVE,
        )
        db.add(competition)
        db.flush()
        db.add(CompetitionMember(competition_id=competition.id, user_id=player_a["id"]))
        db.add(
            Match(
                competition_id=competition.id,
                player1_id=min(player_a["id"], player_b["id"]),
                player2_id=max(player_a["id"], player_b["id"]),
                score1=3,
                score2=0,
                kind=MatchKind.COMPETITION,
                played_on=seoul_today(),
                submitted_by_id=player_a["id"],
            )
        )
        db.commit()

    preview = admin_client.get("/api/v1/admin/database/reset-preview")
    assert preview.status_code == 200
    assert preview.json()["matches"] == 1
    assert preview.json()["players"] == 2
    assert preview.json()["competitions"] == 1
    assert preview.json()["preserved_admins"] == 1

    wrong_phrase = admin_client.post(
        "/api/v1/admin/database/reset",
        json={"confirmation": "삭제", "admin_password": "admin-password"},
    )
    assert wrong_phrase.status_code == 400
    wrong_password = admin_client.post(
        "/api/v1/admin/database/reset",
        json={
            "confirmation": "모든 경기, 대회와 선수 데이터를 삭제합니다",
            "admin_password": "wrong-password",
        },
    )
    assert wrong_password.status_code == 403

    reset = admin_client.post(
        "/api/v1/admin/database/reset",
        json={
            "confirmation": "모든 경기, 대회와 선수 데이터를 삭제합니다",
            "admin_password": "admin-password",
        },
    )
    assert reset.status_code == 200, reset.text
    assert reset.json()["deleted"]["players"] == 2
    assert admin_client.get("/api/v1/auth/me").json()["id"] == admin.id
    assert player_client.get("/api/v1/auth/me").status_code == 401

    with api.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(Match)) == 0
        assert db.scalar(select(func.count()).select_from(Competition)) == 0
        assert db.scalar(select(func.count()).select_from(CompetitionMember)) == 0
        assert db.scalar(select(func.count()).select_from(User)) == 1
        assert db.scalar(select(func.count()).select_from(AuthSession)) == 1
        remaining_admin = db.scalar(select(User))
        assert remaining_admin is not None
        assert remaining_admin.role == UserRole.ADMIN
