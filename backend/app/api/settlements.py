from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import CurrentAdmin, CurrentPlayer, DbSession
from app.core.config import get_settings
from app.schemas.settlements import SettlementSettingsRead, SettlementSettingsUpdate
from app.schemas.stats import SettlementCategoryKey, SettlementDistribution, SettlementResponse
from app.services.settlements import (
    calculate_settlement_tickets,
    get_effective_settlement_settings,
    get_settlement_distribution,
    update_settlement_settings,
)
from app.services.stats import list_player_stats

router = APIRouter(prefix="/settlements", tags=["settlements"])
admin_router = APIRouter(prefix="/admin/settlements", tags=["admin-settlements"])


@router.get("", response_model=SettlementResponse)
def get_my_settlement(db: DbSession, current_player: CurrentPlayer) -> SettlementResponse:
    settings = get_effective_settlement_settings(db)
    rows = list_player_stats(db)
    categories = [
        calculate_settlement_tickets(
            rows,
            user_id=current_player.id,
            category=category,
            prize=getattr(settings.prizes, category.value),
        ).summary
        for category in SettlementCategoryKey
    ]

    return SettlementResponse(
        draws=list(get_settings().settlement_draws),
        categories=categories,
    )


@router.get("/{category}/distribution", response_model=SettlementDistribution)
def get_category_distribution(
    category: SettlementCategoryKey,
    db: DbSession,
    current_player: CurrentPlayer,
) -> SettlementDistribution:
    return get_settlement_distribution(db, user_id=current_player.id, category=category)


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
