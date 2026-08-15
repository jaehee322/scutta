from app.cli import ensure_bootstrap_admin
from app.schemas.stats import RankingCategory
from app.services.stats import get_rankings


def test_bootstrap_admin_is_idempotent_and_excluded_from_rankings(api) -> None:
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
    api.login(client, "admin", "1234")
    changed = client.patch(
        "/api/v1/auth/password",
        json={"current_password": "1234", "new_password": "changed-password"},
    )
    assert changed.status_code == 200, changed.text

    with api.session_factory() as db:
        same_admin, created_after_password_change = ensure_bootstrap_admin(db)
        assert created_after_password_change is False
        assert same_admin.id == admin.id

    api.login(api.client(), "admin", "changed-password")
