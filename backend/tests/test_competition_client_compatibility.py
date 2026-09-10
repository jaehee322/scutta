from datetime import UTC, datetime, timedelta

import pytest

from app.models import Competition, CompetitionStatus, CompetitionType


@pytest.mark.parametrize("role", ["admin", "player"])
def test_cached_two_state_clients_keep_all_competitions_and_filters(api, monkeypatch, role):
    now = datetime(2026, 9, 11, 8, tzinfo=UTC)
    monkeypatch.setattr("app.services.competitions.utc_now", lambda: now)
    api.create_admin()
    admin = api.client()
    api.login(admin, "admin", "admin-password")
    if role == "player":
        response = admin.post(
            "/api/v1/admin/players",
            json={"username": "기존앱선수", "password": "20260000", "gender": "M", "club_rank": 3},
        )
        assert response.status_code == 201
        client = api.client()
        api.login(client, "기존앱선수", "20260000")
        prefix = "/api/v1/competitions"
    else:
        client = admin
        prefix = "/api/v1/admin/competitions"

    with api.session_factory() as db:
        records = [
            Competition(
                name=state.value,
                type=CompetitionType.LEAGUE,
                status=state,
                completed_at=None if state == CompetitionStatus.ACTIVE else now,
                created_at=now - timedelta(minutes=index),
            )
            for index, state in enumerate(CompetitionStatus)
        ]
        db.add_all(records)
        db.commit()
        ids = {item.status.value: item.id for item in records}

    # A cached PWA has never sent the new header and only knows two status values.
    client.headers.pop("X-Competition-Lifecycle")
    legacy = client.get(prefix)
    assert legacy.status_code == 200
    assert {row["id"] for row in legacy.json()} == set(ids.values())
    by_id = {row["id"]: row for row in legacy.json()}
    assert by_id[ids["active"]]["status"] == "active"
    assert by_id[ids["completed"]]["status"] == "active"
    assert by_id[ids["completed"]]["completed_at"] is None
    assert by_id[ids["closed"]]["status"] == "completed"
    for state, expected in [
        ("active", [ids["active"], ids["completed"]]),
        ("completed", [ids["closed"]]),
    ]:
        result = client.get(prefix, params={"status": state})
        assert result.status_code == 200
        assert [row["id"] for row in result.json()] == expected
    assert client.get(f"{prefix}/{ids['closed']}").json()["status"] == "completed"

    # The updated app sees the actual lifecycle and unchanged IDs/results.
    client.headers["X-Competition-Lifecycle"] = "3"
    modern = client.get(prefix)
    assert modern.status_code == 200
    assert {row["id"]: row["status"] for row in modern.json()} == {
        cid: state for state, cid in ids.items()
    }
    for state, cid in ids.items():
        assert client.get(f"{prefix}/{cid}").json()["status"] == state
        assert [row["id"] for row in client.get(prefix, params={"status": state}).json()] == [cid]
    with api.session_factory() as db:
        assert {db.get(Competition, cid).status.value for cid in ids.values()} == set(ids)
