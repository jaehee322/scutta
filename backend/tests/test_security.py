from __future__ import annotations

from datetime import timedelta

import pytest
from pydantic import ValidationError
from sqlalchemy import func, select

from app.api.auth import DUMMY_PASSWORD_HASH, login_rate_limiter
from app.core.config import Settings, get_settings
from app.core.security import utc_now, verify_password
from app.models import AuthSession


def _create_player(admin_client, username: str = "선수", password: str = "20260000") -> dict:
    response = admin_client.post(
        "/api/v1/admin/players",
        json={
            "username": username,
            "password": password,
            "gender": "M",
            "is_freshman": False,
            "club_rank": 5,
        },
    )
    assert response.status_code == 201, response.text
    return response.json()


@pytest.fixture(autouse=True)
def reset_login_limiter():
    login_rate_limiter.reset()
    yield
    login_rate_limiter.reset()


def test_unknown_login_uses_dummy_hash(api, monkeypatch) -> None:
    calls: list[str] = []

    def record_verify(password: str, password_hash: str) -> bool:
        calls.append(password_hash)
        return verify_password(password, password_hash)

    monkeypatch.setattr("app.api.auth.verify_password", record_verify)
    response = api.client().post(
        "/api/v1/auth/login",
        json={"username": "없는 사용자", "password": "wrong-password"},
    )
    assert response.status_code == 401
    assert calls == [DUMMY_PASSWORD_HASH]


def test_login_rate_limit_and_success_reset(api) -> None:
    api.create_admin()
    settings = get_settings()
    original_attempts = settings.login_rate_limit_attempts
    original_window = settings.login_rate_limit_window_seconds
    settings.login_rate_limit_attempts = 2
    settings.login_rate_limit_window_seconds = 60
    try:
        client = api.client()
        payload = {"username": "admin", "password": "wrong-password"}
        assert client.post("/api/v1/auth/login", json=payload).status_code == 401
        assert client.post("/api/v1/auth/login", json=payload).status_code == 401
        limited = client.post("/api/v1/auth/login", json=payload)
        assert limited.status_code == 429
        assert int(limited.headers["retry-after"]) > 0

        login_rate_limiter.reset()
        valid = {"username": "admin", "password": "admin-password"}
        assert client.post("/api/v1/auth/login", json=valid).status_code == 200
        assert not login_rate_limiter.attempts
        assert login_rate_limiter.ip_attempts
        assert client.post("/api/v1/auth/login", json=payload).status_code == 401
    finally:
        settings.login_rate_limit_attempts = original_attempts
        settings.login_rate_limit_window_seconds = original_window


def test_login_prunes_expired_and_old_sessions(api) -> None:
    api.create_admin()
    settings = get_settings()
    original_max = settings.session_max_per_user
    settings.session_max_per_user = 2
    try:
        first = api.client()
        api.login(first, "admin", "admin-password")
        second = api.client()
        api.login(second, "admin", "admin-password")

        with api.session_factory() as db:
            oldest = db.scalar(select(AuthSession).order_by(AuthSession.created_at, AuthSession.id))
            assert oldest is not None
            oldest.expires_at = utc_now() - timedelta(seconds=1)
            db.commit()

        third = api.client()
        api.login(third, "admin", "admin-password")
        fourth = api.client()
        api.login(fourth, "admin", "admin-password")
        with api.session_factory() as db:
            assert db.scalar(select(func.count()).select_from(AuthSession)) == 2
    finally:
        settings.session_max_per_user = original_max


def test_invalid_and_expired_cookie_is_deleted(api) -> None:
    invalid = api.client()
    invalid.cookies.set("scutta_session", "invalid-token", path="/")
    response = invalid.get("/api/v1/auth/me")
    assert response.status_code == 401
    assert "Max-Age=0" in response.headers["set-cookie"]

    api.create_admin()
    expired = api.client()
    api.login(expired, "admin", "admin-password")
    with api.session_factory() as db:
        session = db.scalar(select(AuthSession))
        assert session is not None
        session.expires_at = utc_now() - timedelta(seconds=1)
        db.commit()
    response = expired.get("/api/v1/auth/me")
    assert response.status_code == 401
    assert "Max-Age=0" in response.headers["set-cookie"]


def test_unsafe_cross_origin_is_rejected(api) -> None:
    api.create_admin()
    client = api.client()
    rejected = client.post(
        "/api/v1/auth/login",
        headers={"Origin": "https://evil.example"},
        json={"username": "admin", "password": "admin-password"},
    )
    assert rejected.status_code == 403

    accepted = client.post(
        "/api/v1/auth/login",
        headers={"Origin": "http://localhost:5173"},
        json={"username": "admin", "password": "admin-password"},
    )
    assert accepted.status_code == 200
    assert (
        client.get("/api/v1/auth/me", headers={"Origin": "https://evil.example"}).status_code == 200
    )


def test_render_forwarded_same_origin_is_accepted(api) -> None:
    api.create_admin()
    response = api.client().post(
        "/api/v1/auth/login",
        headers={"Origin": "https://testserver", "X-Forwarded-Proto": "https"},
        json={"username": "admin", "password": "admin-password"},
    )
    assert response.status_code == 200


@pytest.mark.parametrize(
    "origins",
    [[""], ["*"], ["null"], ["http://app.example"], ["https://app.example/path"]],
)
def test_production_rejects_unsafe_cors_origins(origins: list[str]) -> None:
    with pytest.raises(ValidationError):
        Settings(
            environment="production",
            cors_origins=origins,
            session_cookie_secure=True,
            database_url="postgresql://user:password@db.example/app",
        )


def test_production_allows_same_origin_only() -> None:
    settings = Settings(
        environment="production",
        cors_origins=[],
        session_cookie_secure=True,
        database_url="postgresql://user:password@db.example/app",
    )
    assert settings.cors_origins == []


def test_production_rejects_ephemeral_sqlite_database() -> None:
    with pytest.raises(ValidationError, match="PostgreSQL"):
        Settings(
            environment="production",
            cors_origins=[],
            session_cookie_secure=True,
            database_url="sqlite:///./scutta.db",
        )


def test_player_profile_and_password_validation(api) -> None:
    api.create_admin()
    admin = api.client()
    api.login(admin, "admin", "admin-password")

    missing_profile = admin.post(
        "/api/v1/admin/players",
        json={"username": "선수", "password": "20260000"},
    )
    assert missing_profile.status_code == 422

    player = _create_player(admin)
    rank_zero = admin.patch(
        f"/api/v1/admin/players/{player['id']}",
        json={"club_rank": 0},
    )
    assert rank_zero.status_code == 200
    assert rank_zero.json()["club_rank"] == 0
    assert (
        admin.patch(f"/api/v1/admin/players/{player['id']}", json={"club_rank": -3}).status_code
        == 422
    )
    rank_seven = admin.patch(
        f"/api/v1/admin/players/{player['id']}",
        json={"club_rank": 7},
    )
    assert rank_seven.status_code == 200
    assert rank_seven.json()["club_rank"] == 7
    assert (
        admin.patch(f"/api/v1/admin/players/{player['id']}", json={"club_rank": 8}).status_code
        == 422
    )
    assert (
        admin.patch(f"/api/v1/admin/players/{player['id']}", json={"gender": None}).status_code
        == 422
    )
    assert (
        admin.patch(f"/api/v1/admin/players/{player['id']}", json={"club_rank": None}).status_code
        == 422
    )
    assert (
        admin.post(
            "/api/v1/admin/players",
            json={"username": "짧음", "password": "1234567", "gender": "F", "club_rank": 1},
        ).status_code
        == 422
    )
