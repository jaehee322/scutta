from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import SettlementSettings
from app.schemas.settlements import (
    SettlementPrizes,
    SettlementSettingsRead,
    SettlementSettingsUpdate,
)
from app.schemas.stats import (
    RankingCategory,
    SettlementCategory,
    SettlementCategoryKey,
    SettlementDistribution,
    SettlementDistributionEntry,
)
from app.services.stats import PlayerStatsRow, list_player_stats

SETTINGS_ID = 1
PRIZE_ATTRIBUTES = {
    RankingCategory.MATCHES: "matches_prize",
    RankingCategory.WINS: "wins_prize",
    RankingCategory.LOSSES: "losses_prize",
    RankingCategory.OPPONENTS: "opponents_prize",
}


@dataclass(frozen=True, slots=True)
class SettlementTicketCalculation:
    summary: SettlementCategory
    tickets_by_player: dict[int, int]


def _probability_percent(tickets: int, total_tickets: int) -> float:
    return round(tickets / total_tickets * 100, 2) if total_tickets else 0.0


def calculate_settlement_tickets(
    rows: list[PlayerStatsRow],
    *,
    user_id: int,
    category: SettlementCategoryKey,
    prize: str,
) -> SettlementTicketCalculation:
    mine = next((row for row in rows if row.user_id == user_id), None)
    value = getattr(mine, category.value) if mine is not None else 0
    tickets_by_player = {row.user_id: getattr(row, category.value) // 10 for row in rows}
    tickets = tickets_by_player.get(user_id, 0)
    total_tickets = sum(tickets_by_player.values())
    return SettlementTicketCalculation(
        summary=SettlementCategory(
            category=category,
            prize=prize,
            value=value,
            tickets=tickets,
            total_tickets=total_tickets,
            probability_percent=_probability_percent(tickets, total_tickets),
        ),
        tickets_by_player=tickets_by_player,
    )


def get_settlement_distribution(
    db: Session, *, user_id: int, category: SettlementCategoryKey
) -> SettlementDistribution:
    settings = get_effective_settlement_settings(db)
    rows = list_player_stats(db)
    calculation = calculate_settlement_tickets(
        rows, user_id=user_id, category=category, prize=getattr(settings.prizes, category.value)
    )
    tickets_by_player = calculation.tickets_by_player
    holders = sorted(
        (row for row in rows if tickets_by_player[row.user_id] > 0),
        key=lambda row: (-tickets_by_player[row.user_id], row.username.casefold(), row.user_id),
    )
    entries = []
    previous_tickets = None
    rank = 0
    for position, row in enumerate(holders, start=1):
        tickets = tickets_by_player[row.user_id]
        if tickets != previous_tickets:
            rank = position
        entries.append(
            SettlementDistributionEntry(
                player_id=row.user_id,
                username=row.username,
                tickets=tickets,
                probability_percent=_probability_percent(
                    tickets, calculation.summary.total_tickets
                ),
                rank=rank,
            )
        )
        previous_tickets = tickets
    return SettlementDistribution(
        **calculation.summary.model_dump(), holder_count=len(entries), entries=entries
    )


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
        select(SettlementSettings).where(SettlementSettings.id == SETTINGS_ID).with_for_update()
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
