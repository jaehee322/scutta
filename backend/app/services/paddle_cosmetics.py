from __future__ import annotations

import secrets
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.paddle_cosmetics import (
    DEFAULT_PADDLE_EQUIPMENT,
    PADDLE_CHEST_SKINS,
    PADDLE_SKIN_CATEGORIES,
)
from app.models import PaddleFlightChestClaim, PaddleFlightCosmetics, PaddleFlightOwnedSkin, User
from app.schemas.paddle_cosmetics import (
    PaddleFlightChestResponse,
    PaddleFlightCosmeticsRead,
    PaddleFlightEquipment,
)


class InvalidPaddleEquipmentError(Exception):
    pass


class CosmeticsPlayerUnavailableError(Exception):
    pass


def _lock_cosmetics(db: Session, user_id: int) -> PaddleFlightCosmetics:
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        insert = postgres_insert
    elif dialect == "sqlite":
        insert = sqlite_insert
    else:
        raise RuntimeError("Paddle cosmetics requires SQLite or PostgreSQL")
    # A first-write upsert locks this account before reading claims or ownership.
    # Child tables reference this row, so inserts do not acquire user-row locks
    # after the cosmetics lock (account deletion cascades through the same row).
    statement = (
        insert(PaddleFlightCosmetics)
        .values(user_id=user_id)
        .on_conflict_do_update(
            index_elements=[PaddleFlightCosmetics.user_id],
            set_={"opened_chests": PaddleFlightCosmetics.opened_chests},
        )
        .returning(PaddleFlightCosmetics)
        .execution_options(populate_existing=True)
    )
    try:
        return db.execute(statement).scalar_one()
    except IntegrityError as error:
        db.rollback()
        if db.scalar(select(User.id).where(User.id == user_id)) is None:
            raise CosmeticsPlayerUnavailableError("계정을 다시 확인해 주세요.") from error
        raise


def get_paddle_cosmetics(db: Session, *, user_id: int) -> PaddleFlightCosmeticsRead:
    # One statement keeps the count, equipment and ownership in the same snapshot.
    rows = db.execute(
        select(PaddleFlightCosmetics, PaddleFlightOwnedSkin.skin_id)
        .outerjoin(
            PaddleFlightOwnedSkin, PaddleFlightOwnedSkin.user_id == PaddleFlightCosmetics.user_id
        )
        .where(PaddleFlightCosmetics.user_id == user_id)
        .execution_options(populate_existing=True)
    ).all()
    if not rows:
        return PaddleFlightCosmeticsRead(
            owned=list(DEFAULT_PADDLE_EQUIPMENT.values()),
            equipped=PaddleFlightEquipment(**DEFAULT_PADDLE_EQUIPMENT),
            opened_chests=0,
        )
    state = rows[0][0]
    acquired = {row[1] for row in rows if row[1] is not None}
    return PaddleFlightCosmeticsRead(
        owned=[
            *DEFAULT_PADDLE_EQUIPMENT.values(),
            *(skin for skin, _, _ in PADDLE_CHEST_SKINS if skin in acquired),
        ],
        equipped=PaddleFlightEquipment(
            background=state.background, paddle=state.paddle, ball=state.ball
        ),
        opened_chests=state.opened_chests,
    )


def equip_paddle_cosmetics(
    db: Session, *, user_id: int, equipment: PaddleFlightEquipment
) -> PaddleFlightCosmeticsRead:
    for category, skin_id in equipment.model_dump().items():
        if PADDLE_SKIN_CATEGORIES.get(skin_id) != category:
            raise InvalidPaddleEquipmentError("스킨 종류가 맞지 않습니다.")
    state = _lock_cosmetics(db, user_id)
    owned = set(get_paddle_cosmetics(db, user_id=user_id).owned)
    if not set(equipment.model_dump().values()) <= owned:
        db.rollback()
        raise InvalidPaddleEquipmentError("보유한 스킨만 장착할 수 있습니다.")
    for category, skin_id in equipment.model_dump().items():
        setattr(state, category, skin_id)
    db.flush()
    snapshot = get_paddle_cosmetics(db, user_id=user_id)
    db.commit()
    return snapshot


def choose_paddle_chest_skin() -> str:
    roll = secrets.randbelow(sum(weight for _skin, _category, weight in PADDLE_CHEST_SKINS))
    for skin_id, _category, weight in PADDLE_CHEST_SKINS:
        if roll < weight:
            return skin_id
        roll -= weight
    raise AssertionError("Chest roll outside the configured pool")


def open_paddle_chest(db: Session, *, user_id: int, claim_id: UUID) -> PaddleFlightChestResponse:
    state = _lock_cosmetics(db, user_id)
    previous = db.get(PaddleFlightChestClaim, (user_id, claim_id))
    if previous is None:
        skin_id = choose_paddle_chest_skin()
        duplicate = db.get(PaddleFlightOwnedSkin, (user_id, skin_id)) is not None
        if not duplicate:
            db.add(PaddleFlightOwnedSkin(user_id=user_id, skin_id=skin_id))
        previous = PaddleFlightChestClaim(
            user_id=user_id, claim_id=claim_id, skin_id=skin_id, duplicate=duplicate
        )
        db.add(previous)
        state.opened_chests += 1
        db.flush()
    response = PaddleFlightChestResponse(
        cosmetics=get_paddle_cosmetics(db, user_id=user_id),
        skin_id=previous.skin_id,
        duplicate=previous.duplicate,
    )
    db.commit()
    return response
