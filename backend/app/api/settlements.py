from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_player
from app.core.config import get_settings
from app.core.database import get_db
from app.models import User
from app.schemas.stats import RankingCategory, SettlementCategory, SettlementResponse
from app.services.stats import list_player_stats

router = APIRouter(prefix="/settlements", tags=["settlements"])

DbSession = Annotated[Session, Depends(get_db)]
CurrentPlayer = Annotated[User, Depends(get_current_player)]


@router.get("", response_model=SettlementResponse)
def get_my_settlement(db: DbSession, current_player: CurrentPlayer) -> SettlementResponse:
    settings = get_settings()
    rows = list_player_stats(db)
    mine = next((row for row in rows if row.user_id == current_player.id), None)

    categories = []
    for category in RankingCategory:
        value = mine.value_for(category) if mine is not None else 0
        tickets = value // 10
        total_tickets = sum(row.value_for(category) // 10 for row in rows)
        probability = (tickets / total_tickets * 100) if total_tickets else 0.0
        categories.append(
            SettlementCategory(
                category=category,
                prize=settings.settlement_prizes.get(category.value, ""),
                value=value,
                tickets=tickets,
                total_tickets=total_tickets,
                probability_percent=round(probability, 2),
            )
        )

    return SettlementResponse(
        draws=list(settings.settlement_draws),
        categories=categories,
    )
