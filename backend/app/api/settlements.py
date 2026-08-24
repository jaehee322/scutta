from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import CurrentAdmin, CurrentPlayer, DbSession
from app.core.config import get_settings
from app.schemas.settlements import SettlementSettingsRead, SettlementSettingsUpdate
from app.schemas.stats import SettlementCategory, SettlementCategoryKey, SettlementResponse
from app.services.settlements import (
    get_effective_settlement_settings,
    update_settlement_settings,
)
from app.services.stats import list_player_stats

router = APIRouter(prefix="/settlements", tags=["settlements"])
admin_router = APIRouter(prefix="/admin/settlements", tags=["admin-settlements"])


@router.get("", response_model=SettlementResponse)
def get_my_settlement(db: DbSession, current_player: CurrentPlayer) -> SettlementResponse:
    settings = get_effective_settlement_settings(db)
    rows = list_player_stats(db)
    mine = next((row for row in rows if row.user_id == current_player.id), None)

    categories = []
    for category in SettlementCategoryKey:
        value = getattr(mine, category.value) if mine is not None else 0
        tickets = value // 10
        total_tickets = sum(getattr(row, category.value) // 10 for row in rows)
        probability = (tickets / total_tickets * 100) if total_tickets else 0.0
        categories.append(
            SettlementCategory(
                category=category,
                prize=getattr(settings.prizes, category.value),
                value=value,
                tickets=tickets,
                total_tickets=total_tickets,
                probability_percent=round(probability, 2),
            )
        )

    return SettlementResponse(
        draws=list(get_settings().settlement_draws),
        categories=categories,
    )


@admin_router.get("/settings", response_model=SettlementSettingsRead)
def get_admin_settlement_settings(
    db: DbSession,
    _: CurrentAdmin,
) -> SettlementSettingsRead:
    return get_effective_settlement_settings(db)


@admin_router.patch("/settings", response_model=SettlementSettingsRead)
def patch_admin_settlement_settings(
    payload: SettlementSettingsUpdate,
    db: DbSession,
    _: CurrentAdmin,
) -> SettlementSettingsRead:
    return update_settlement_settings(db, payload)
