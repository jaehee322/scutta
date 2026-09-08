from __future__ import annotations

from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4

import pytest
from sqlalchemy import event, func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import sessionmaker

from app.api.auth import login_rate_limiter
from app.core.database import Base, create_database_engine
from app.core.paddle_cosmetics import DEFAULT_PADDLE_EQUIPMENT, PADDLE_CHEST_SKINS
from app.core.security import hash_password
from app.models import (
    Gender,
    PaddleFlightChestClaim,
    PaddleFlightCosmetics,
    PaddleFlightOwnedSkin,
    User,
    UserRole,
)
from app.schemas.admin import DATABASE_RESET_CONFIRMATION, PADDLE_FLIGHT_RESET_CONFIRMATION
from app.schemas.paddle_cosmetics import PaddleFlightEquipment
from app.services.paddle_cosmetics import (
    choose_paddle_chest_skin,
    equip_paddle_cosmetics,
    get_paddle_cosmetics,
    open_paddle_chest,
)

PATH = "/api/v1/minigames/paddle-flight/cosmetics"
PASSWORD = "cosmetics-test-password"
DEFAULT_SNAPSHOT = {
    "owned": ["bg_classic", "paddle_classic", "ball_classic"],
    "equipped": DEFAULT_PADDLE_EQUIPMENT,
    "opened_chests": 0,
}


@pytest.fixture(autouse=True)
def isolate_cosmetics_login_limits():
    login_rate_limiter.reset()
    yield
    login_rate_limiter.reset()


@pytest.fixture
def cosmetics_player(api):
    api.create_admin()
    admin = api.client()
    api.login(admin, "admin", "admin-password")
    created = admin.post(
        "/api/v1/admin/players",
        json={"username": "스킨선수", "password": PASSWORD, "gender": "M", "club_rank": 4},
    )
    assert created.status_code == 201, created.text
    client = api.client()
    api.login(client, "스킨선수", PASSWORD)
    return admin, created.json()["id"], client


def test_cosmetics_defaults_are_read_only_and_endpoints_are_player_only(
    api, cosmetics_player
) -> None:
    admin, _, client = cosmetics_player
    anonymous = api.client()
    for requester, expected in ((anonymous, 401), (admin, 403)):
        assert requester.get(PATH).status_code == expected
        assert requester.patch(PATH, json=DEFAULT_PADDLE_EQUIPMENT).status_code == expected
        assert (
            requester.post(f"{PATH}/chests", json={"claim_id": str(uuid4())}).status_code
            == expected
        )
    assert client.get(PATH).json() == DEFAULT_SNAPSHOT
    with api.session_factory() as db:
        assert db.scalar(select(func.count()).select_from(PaddleFlightCosmetics)) == 0
    assert client.patch(PATH, json=DEFAULT_PADDLE_EQUIPMENT).json() == DEFAULT_SNAPSHOT
    # The existing score contract remains separate from cosmetics.
    assert client.get("/api/v1/minigames/paddle-flight").json() == {"best_score": 0, "ranking": []}


def test_chest_receipts_are_idempotent_and_retry_returns_current_cosmetics(
    api, cosmetics_player, monkeypatch
) -> None:
    _, player_id, client = cosmetics_player
    skin = "bg_dawn"
    rolls = []

    def choose():
        rolls.append(skin)
        return skin

    monkeypatch.setattr("app.services.paddle_cosmetics.choose_paddle_chest_skin", choose)
    first_id = str(uuid4())
    first = client.post(f"{PATH}/chests", json={"claim_id": first_id})
    assert first.status_code == 200, first.text
    assert first.json()["skin_id"] == "bg_dawn"
    assert first.json()["duplicate"] is False
    assert first.json()["cosmetics"]["opened_chests"] == 1
    assert first.json()["cosmetics"]["owned"] == DEFAULT_SNAPSHOT["owned"] + ["bg_dawn"]
    assert client.post(f"{PATH}/chests", json={"claim_id": first_id}).json() == first.json()
    assert rolls == ["bg_dawn"]

    second_id = str(uuid4())
    duplicate = client.post(f"{PATH}/chests", json={"claim_id": second_id}).json()
    assert duplicate["duplicate"] is True
    assert duplicate["cosmetics"]["opened_chests"] == 2
    assert len(duplicate["cosmetics"]["owned"]) == 4
    equipment = {**DEFAULT_PADDLE_EQUIPMENT, "background": "bg_dawn"}
    assert client.patch(PATH, json=equipment).json()["equipped"] == equipment
    skin = "ball_solar"
    third = client.post(f"{PATH}/chests", json={"claim_id": str(uuid4())}).json()
    retried = client.post(f"{PATH}/chests", json={"claim_id": first_id}).json()
    assert retried["skin_id"] == "bg_dawn" and retried["duplicate"] is False
    assert retried["cosmetics"] == third["cosmetics"]
    assert retried["cosmetics"]["equipped"] == equipment
    assert client.post(f"{PATH}/chests", json={"claim_id": second_id}).json()["duplicate"] is True
    assert rolls == ["bg_dawn", "bg_dawn", "ball_solar"]
    with api.session_factory() as db:
        assert db.get(PaddleFlightCosmetics, player_id).opened_chests == 3
        assert db.scalar(select(func.count()).select_from(PaddleFlightOwnedSkin)) == 2
        assert db.scalar(select(func.count()).select_from(PaddleFlightChestClaim)) == 3


def test_equipment_requires_owned_correct_category_and_updates_all_slots_atomically(
    cosmetics_player, monkeypatch
) -> None:
    _, _, client = cosmetics_player
    for skin in ("bg_dawn", "paddle_jade", "ball_sky"):
        monkeypatch.setattr(
            "app.services.paddle_cosmetics.choose_paddle_chest_skin", lambda skin=skin: skin
        )
        assert client.post(f"{PATH}/chests", json={"claim_id": str(uuid4())}).status_code == 200
    equipment = {"background": "bg_dawn", "paddle": "paddle_jade", "ball": "ball_sky"}
    equipped = client.patch(PATH, json=equipment)
    assert equipped.status_code == 200, equipped.text
    assert equipped.json()["equipped"] == equipment
    for invalid in (
        {**equipment, "background": "paddle_jade"},
        {**equipment, "ball": "unknown"},
        {**DEFAULT_PADDLE_EQUIPMENT, "paddle": "paddle_imperial"},
        {"background": "bg_dawn"},
        {**equipment, "ball": None},
        {**equipment, "user_id": 999},
    ):
        response = client.patch(PATH, json=invalid)
        assert response.status_code == 422, response.text
        assert client.get(PATH).json() == equipped.json()
    restored = client.patch(PATH, json=DEFAULT_PADDLE_EQUIPMENT).json()
    assert restored["equipped"] == DEFAULT_PADDLE_EQUIPMENT
    assert restored["owned"] == equipped.json()["owned"]
    assert restored["opened_chests"] == 3


def test_claim_ids_and_ownership_are_scoped_to_the_authenticated_account(
    api, cosmetics_player, monkeypatch
) -> None:
    admin, player_id, client = cosmetics_player
    other = admin.post(
        "/api/v1/admin/players",
        json={"username": "다른스킨선수", "password": PASSWORD, "gender": "F", "club_rank": 3},
    ).json()
    other_client = api.client()
    api.login(other_client, other["username"], PASSWORD)
    claim_id = str(uuid4())
    monkeypatch.setattr("app.services.paddle_cosmetics.choose_paddle_chest_skin", lambda: "bg_dawn")
    client.post(f"{PATH}/chests", json={"claim_id": claim_id})
    assert other_client.get(PATH, params={"user_id": player_id}).json() == DEFAULT_SNAPSHOT
    assert (
        other_client.patch(
            PATH, json={**DEFAULT_PADDLE_EQUIPMENT, "background": "bg_dawn"}
        ).status_code
        == 422
    )
    monkeypatch.setattr(
        "app.services.paddle_cosmetics.choose_paddle_chest_skin", lambda: "ball_solar"
    )
    response = other_client.post(f"{PATH}/chests", json={"claim_id": claim_id})
    assert response.status_code == 200, response.text
    assert response.json()["skin_id"] == "ball_solar"
    assert response.json()["duplicate"] is False
    assert response.json()["cosmetics"]["opened_chests"] == 1
    assert "bg_dawn" not in response.json()["cosmetics"]["owned"]
    assert "ball_solar" not in client.get(PATH).json()["owned"]
    before = client.get(PATH).json()
    for payload in (
        {},
        {"claim_id": "not-a-uuid"},
        {"claim_id": 1},
        {"claim_id": str(uuid4()), "skin_id": "bg_cosmos"},
        {"claim_id": str(uuid4()), "user_id": other["id"]},
    ):
        assert client.post(f"{PATH}/chests", json=payload).status_code == 422
        assert client.get(PATH).json() == before


def test_chest_pool_has_exact_weights_and_excludes_defaults(monkeypatch) -> None:
    total = sum(weight for _, _, weight in PADDLE_CHEST_SKINS)
    outcomes = []
    for roll in range(total):
        monkeypatch.setattr(
            "app.services.paddle_cosmetics.secrets.randbelow", lambda bound, roll=roll: roll
        )
        outcomes.append(choose_paddle_chest_skin())
    assert total == 183
    assert len(PADDLE_CHEST_SKINS) == 24
    assert Counter(outcomes) == {skin: weight for skin, _, weight in PADDLE_CHEST_SKINS}
    assert not set(outcomes) & set(DEFAULT_PADDLE_EQUIPMENT.values())
    for category in DEFAULT_PADDLE_EQUIPMENT:
        assert sorted(weight for _, group, weight in PADDLE_CHEST_SKINS if group == category) == [
            1,
            4,
            4,
            4,
            12,
            12,
            12,
            12,
        ]
        assert sum(weight for _, group, weight in PADDLE_CHEST_SKINS if group == category) == 61


@pytest.mark.parametrize(
    ("skin_id", "category", "weight"),
    [
        ("bg_sakura", "background", 12),
        ("bg_glacier", "background", 4),
        ("paddle_maple", "paddle", 12),
        ("paddle_titanium", "paddle", 4),
        ("ball_berry", "ball", 12),
        ("ball_lagoon", "ball", 4),
    ],
)
def test_expansion_skins_can_be_drawn_and_equipped_without_losing_existing_ownership(
    cosmetics_player, monkeypatch, skin_id, category, weight
) -> None:
    _, _, client = cosmetics_player
    monkeypatch.setattr("app.services.paddle_cosmetics.secrets.randbelow", lambda bound: 0)
    original_claim = str(uuid4())
    original = client.post(f"{PATH}/chests", json={"claim_id": original_claim}).json()
    assert original["skin_id"] == "bg_dawn"
    old_equipment = {**DEFAULT_PADDLE_EQUIPMENT, "background": "bg_dawn"}
    assert client.patch(PATH, json=old_equipment).status_code == 200

    offset = 0
    for candidate, group, configured_weight in PADDLE_CHEST_SKINS:
        if candidate == skin_id:
            assert (group, configured_weight) == (category, weight)
            break
        offset += configured_weight

    def roll(bound):
        assert bound == 183
        return offset

    monkeypatch.setattr("app.services.paddle_cosmetics.secrets.randbelow", roll)
    opened = client.post(f"{PATH}/chests", json={"claim_id": str(uuid4())})
    assert opened.status_code == 200, opened.text
    assert opened.json()["skin_id"] == skin_id
    assert opened.json()["duplicate"] is False
    assert set(opened.json()["cosmetics"]["owned"]) == set(original["cosmetics"]["owned"]) | {
        skin_id
    }
    assert opened.json()["cosmetics"]["equipped"] == old_equipment
    new_equipment = {**old_equipment, category: skin_id}
    equipped = client.patch(PATH, json=new_equipment)
    assert equipped.status_code == 200, equipped.text
    assert equipped.json()["equipped"] == new_equipment
    assert equipped.json()["opened_chests"] == 2
    replay = client.post(f"{PATH}/chests", json={"claim_id": original_claim}).json()
    assert replay["skin_id"] == "bg_dawn" and replay["duplicate"] is False
    assert replay["cosmetics"] == equipped.json()


def test_score_reset_preserves_skins_but_player_deletion_and_full_reset_cascade(
    api, cosmetics_player, monkeypatch
) -> None:
    admin, player_id, client = cosmetics_player
    monkeypatch.setattr("app.services.paddle_cosmetics.choose_paddle_chest_skin", lambda: "bg_dawn")
    client.post(f"{PATH}/chests", json={"claim_id": str(uuid4())})
    before = client.patch(PATH, json={**DEFAULT_PADDLE_EQUIPMENT, "background": "bg_dawn"}).json()
    client.post("/api/v1/minigames/paddle-flight/score", json={"score": 5})
    reset = admin.post(
        "/api/v1/admin/minigames/paddle-flight/reset",
        json={"confirmation": PADDLE_FLIGHT_RESET_CONFIRMATION, "admin_password": "admin-password"},
    )
    assert reset.status_code == 200, reset.text
    assert client.get(PATH).json() == before
    assert client.get("/api/v1/minigames/paddle-flight").json()["best_score"] == 0
    assert admin.delete(f"/api/v1/admin/players/{player_id}").status_code == 204
    with api.session_factory() as db:
        for model in (PaddleFlightCosmetics, PaddleFlightOwnedSkin, PaddleFlightChestClaim):
            assert db.scalar(select(func.count()).select_from(model)) == 0
    assert client.get(PATH).status_code == 401

    created = admin.post(
        "/api/v1/admin/players",
        json={"username": "전체초기화스킨", "password": PASSWORD, "gender": "M", "club_rank": 4},
    ).json()
    second = api.client()
    api.login(second, created["username"], PASSWORD)
    second.post(f"{PATH}/chests", json={"claim_id": str(uuid4())})
    reset_all = admin.post(
        "/api/v1/admin/database/reset",
        json={"confirmation": DATABASE_RESET_CONFIRMATION, "admin_password": "admin-password"},
    )
    assert reset_all.status_code == 200, reset_all.text
    with api.session_factory() as db:
        for model in (PaddleFlightCosmetics, PaddleFlightOwnedSkin, PaddleFlightChestClaim):
            assert db.scalar(select(func.count()).select_from(model)) == 0


def test_chest_transaction_rolls_back_if_receipt_cannot_be_saved(
    api, cosmetics_player, monkeypatch
) -> None:
    _, _, client = cosmetics_player
    monkeypatch.setattr("app.services.paddle_cosmetics.choose_paddle_chest_skin", lambda: "bg_dawn")
    engine = api.session_factory.kw["bind"]

    def reject_receipt(_connection, _cursor, statement, _parameters, _context, _many):
        if statement.startswith("INSERT INTO paddle_flight_chest_claims"):
            raise RuntimeError("receipt storage failed")

    event.listen(engine, "before_cursor_execute", reject_receipt)
    try:
        with pytest.raises(RuntimeError, match="receipt storage failed"):
            client.post(f"{PATH}/chests", json={"claim_id": str(uuid4())})
    finally:
        event.remove(engine, "before_cursor_execute", reject_receipt)
    assert client.get(PATH).json() == DEFAULT_SNAPSHOT
    with api.session_factory() as db:
        for model in (PaddleFlightCosmetics, PaddleFlightOwnedSkin, PaddleFlightChestClaim):
            assert db.scalar(select(func.count()).select_from(model)) == 0


def test_database_rejects_invalid_cosmetic_rows(api, cosmetics_player) -> None:
    _, player_id, client = cosmetics_player
    client.patch(PATH, json=DEFAULT_PADDLE_EQUIPMENT)
    with api.session_factory() as db:
        state = db.get(PaddleFlightCosmetics, player_id)
        for field, value in (("opened_chests", -1), ("background", "ball_classic")):
            setattr(state, field, value)
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()
        db.add(PaddleFlightOwnedSkin(user_id=player_id, skin_id="invented_skin"))
        with pytest.raises(IntegrityError):
            db.commit()
        db.rollback()


@pytest.mark.parametrize(
    "scenario", ["same_claim", "same_skin", "different_skins", "equip", "first_equip"]
)
def test_concurrent_cosmetic_mutations_preserve_receipts_ownership_and_equipment(
    tmp_path, monkeypatch, scenario
) -> None:
    database_path = tmp_path / "cosmetics-concurrency.db"
    engine = create_database_engine(f"sqlite:///{database_path.as_posix()}")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)
    with factory() as db:
        player = User(
            username="동시스킨",
            password_hash=hash_password(PASSWORD),
            role=UserRole.PLAYER,
            gender=Gender.MALE,
            club_rank=4,
        )
        db.add(player)
        db.commit()
        player_id = player.id
    chosen = []

    def choose():
        skin = "bg_dawn" if not chosen or scenario in ("same_claim", "same_skin") else "bg_mint"
        chosen.append(skin)
        return skin

    monkeypatch.setattr("app.services.paddle_cosmetics.choose_paddle_chest_skin", choose)
    if scenario == "equip":
        with factory() as db:
            open_paddle_chest(db, user_id=player_id, claim_id=uuid4())
    claim_ids = [uuid4(), uuid4()]
    if scenario == "same_claim":
        claim_ids[1] = claim_ids[0]
    barrier = Barrier(2)

    def submit(index):
        with factory() as db:
            barrier.wait(timeout=5)
            if index == 1 and scenario in ("equip", "first_equip"):
                equipment = {
                    **DEFAULT_PADDLE_EQUIPMENT,
                    "background": "bg_dawn" if scenario == "equip" else "bg_classic",
                }
                return equip_paddle_cosmetics(
                    db, user_id=player_id, equipment=PaddleFlightEquipment(**equipment)
                )
            return open_paddle_chest(db, user_id=player_id, claim_id=claim_ids[index])

    try:
        with ThreadPoolExecutor(max_workers=2) as executor:
            results = list(executor.map(submit, (0, 1)))
        with factory() as db:
            snapshot = get_paddle_cosmetics(db, user_id=player_id)
            expected_count = 1 if scenario in ("same_claim", "first_equip") else 2
            assert snapshot.opened_chests == expected_count
            assert set(snapshot.owned) == set(DEFAULT_PADDLE_EQUIPMENT.values()) | set(chosen)
            assert (
                db.scalar(select(func.count()).select_from(PaddleFlightChestClaim))
                == expected_count
            )
            assert db.scalar(select(func.count()).select_from(PaddleFlightOwnedSkin)) == len(
                set(chosen)
            )
            assert snapshot.equipped.background == (
                "bg_dawn" if scenario == "equip" else "bg_classic"
            )
        if scenario == "same_claim":
            assert len(chosen) == 1
            assert results[0] == results[1]
        if scenario == "same_skin":
            assert sorted(result.duplicate for result in results) == [False, True]
    finally:
        engine.dispose()
