import pytest
from pydantic import SecretStr
from sqlalchemy import func, select

from app import cli
from app.cli import ensure_bootstrap_admin
from app.core.config import Settings, get_settings
from app.models import AuthSession, User
from app.schemas.admin import DATABASE_RESET_CONFIRMATION
from app.schemas.stats import RankingCategory
from app.services.stats import get_rankings


def test_bootstrap_admin_is_idempotent_and_excluded_from_rankings(api, monkeypatch) -> None:
    initial_password = "private-initial-password"
    monkeypatch.setattr(get_settings(), "bootstrap_admin_password", SecretStr(initial_password))
    with api.session_factory() as db:
        admin, created = ensure_bootstrap_admin(db)
        assert created is True
        assert admin.username == "admin"

        same_admin, created_again = ensure_bootstrap_admin(db)
        assert created_again is False
        assert same_admin.id == admin.id

        rankings = get_rankings(db)
        assert all(rankings[category] == [] for category in RankingCategory)

    client = api.client()
    api.login(client, "admin", initial_password)
    reset = client.post(
        "/api/v1/admin/database/reset",
        json={
            "confirmation": DATABASE_RESET_CONFIRMATION,
            "admin_password": initial_password,
        },
    )
    assert reset.status_code == 200, reset.text

    changed = client.patch(
        "/api/v1/auth/password",
        json={"current_password": initial_password, "new_password": "changed-password"},
    )
    assert changed.status_code == 200, changed.text

    monkeypatch.setattr(get_settings(), "bootstrap_admin_password", None)
    with api.session_factory() as db:
        same_admin, created_after_password_change = ensure_bootstrap_admin(db)
        assert created_after_password_change is False
        assert same_admin.id == admin.id

    api.login(api.client(), "admin", "changed-password")
    assert client.get("/api/v1/auth/me").status_code == 200


@pytest.mark.parametrize("password", [None, "", "1234", " " * 8, "x" * 129])
def test_bootstrap_rejects_missing_or_invalid_password_without_creating_admin(
    api, monkeypatch, password
) -> None:
    configured = SecretStr(password) if password is not None else None
    monkeypatch.setattr(get_settings(), "bootstrap_admin_password", configured)
    with api.session_factory() as db:
        with pytest.raises(ValueError, match="BOOTSTRAP_ADMIN_PASSWORD"):
            ensure_bootstrap_admin(db)
        assert db.scalar(select(func.count()).select_from(User)) == 0


@pytest.mark.parametrize("password", [None, "1234", "replacement-password"])
def test_existing_admin_and_sessions_are_preserved_without_valid_bootstrap_secret(
    api, monkeypatch, password
) -> None:
    # Preserve even a legacy password: this startup change must never reset an
    # existing account, regardless of its name or current credentials.
    admin = api.create_admin(username="operator", password="1234")
    client = api.client()
    api.login(client, "operator", "1234")
    configured = SecretStr(password) if password is not None else None
    monkeypatch.setattr(get_settings(), "bootstrap_admin_password", configured)

    with api.session_factory() as db:
        preserved, created = ensure_bootstrap_admin(db)
        assert created is False
        assert preserved.id == admin.id
        assert preserved.password_hash == admin.password_hash
        assert preserved.auth_version == admin.auth_version
        assert db.scalar(select(func.count()).select_from(User)) == 1
        assert db.scalar(select(func.count()).select_from(AuthSession)) == 1

    assert client.get("/api/v1/auth/me").status_code == 200


def test_bootstrap_uses_environment_password_and_never_the_old_default(api, monkeypatch) -> None:
    password = "environment-bootstrap-password"
    monkeypatch.setenv("BOOTSTRAP_ADMIN_PASSWORD", password)
    configured = Settings(_env_file=None)
    monkeypatch.setattr(cli, "get_settings", lambda: configured)

    with api.session_factory() as db:
        _, created = ensure_bootstrap_admin(db)
        assert created is True

    client = api.client()
    default_login = client.post(
        "/api/v1/auth/login", json={"username": "admin", "password": "1234"}
    )
    assert default_login.status_code == 401
    api.login(client, "admin", password)
    assert password not in repr(configured)


def test_bootstrap_cli_fails_without_disclosing_invalid_password(api, monkeypatch, capsys) -> None:
    secret = "short!"
    monkeypatch.setattr(get_settings(), "bootstrap_admin_password", SecretStr(secret))
    monkeypatch.setattr(cli, "SessionLocal", api.session_factory)

    assert cli.main(["ensure-admin"]) == 1
    output = capsys.readouterr()
    assert "BOOTSTRAP_ADMIN_PASSWORD" in output.err
    assert secret not in output.out + output.err
