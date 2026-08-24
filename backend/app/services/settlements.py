from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import SettlementSettings
from app.schemas.settlements import (
    SettlementPrizes,
    SettlementSettingsRead,
    SettlementSettingsUpdate,
)
from app.schemas.stats import RankingCategory

SETTINGS_ID = 1
PRIZE_ATTRIBUTES = {
    RankingCategory.MATCHES: "matches_prize",
    RankingCategory.WINS: "wins_prize",
    RankingCategory.LOSSES: "losses_prize",
    RankingCategory.OPPONENTS: "opponents_prize",
}


def get_effective_settlement_settings(db: Session) -> SettlementSettingsRead:
    configured = get_settings()
    stored = db.get(SettlementSettings, SETTINGS_ID)
    prizes: dict[str, str] = {}

    for category, attribute in PRIZE_ATTRIBUTES.items():
        override = getattr(stored, attribute) if stored is not None else None
        prizes[category.value] = (
            override
            if override is not None
            else configured.settlement_prizes.get(category.value, "")
        )

    return SettlementSettingsRead(
        prizes=SettlementPrizes(**prizes),
    )


def update_settlement_settings(
    db: Session,
    payload: SettlementSettingsUpdate,
) -> SettlementSettingsRead:
    stored = db.scalar(
        select(SettlementSettings)
        .where(SettlementSettings.id == SETTINGS_ID)
        .with_for_update()
    )
    if stored is None:
        stored = SettlementSettings(id=SETTINGS_ID)
        db.add(stored)

    if "prizes" in payload.model_fields_set:
        assert payload.prizes is not None
        for category in RankingCategory:
            if category.value in payload.prizes.model_fields_set:
                value = getattr(payload.prizes, category.value)
                assert value is not None
                setattr(stored, PRIZE_ATTRIBUTES[category], value)

    db.commit()
    return get_effective_settlement_settings(db)
