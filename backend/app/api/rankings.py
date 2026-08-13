from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_player
from app.core.database import get_db
from app.models import User
from app.schemas.stats import (
    PlayerSummary,
    RankingCategory,
    RankingEntry,
    RankingsResponse,
    RankingTable,
)
from app.services.stats import get_rankings as get_rankings_data

router = APIRouter(prefix="/rankings", tags=["rankings"])

DbSession = Annotated[Session, Depends(get_db)]
CurrentPlayer = Annotated[User, Depends(get_current_player)]


@router.get("", response_model=RankingsResponse)
def get_rankings(db: DbSession, _current_player: CurrentPlayer) -> RankingsResponse:
    rankings = get_rankings_data(db)
    tables = []
    for category in RankingCategory:
        entries = [
            RankingEntry(
                rank=row.rank,
                player=PlayerSummary(
                    id=row.player.user_id,
                    username=row.player.username,
                    gender=row.player.gender,
                    is_freshman=row.player.is_freshman,
                    club_rank=row.player.club_rank,
                ),
                value=row.value,
            )
            for row in rankings[category]
        ]
        tables.append(RankingTable(category=category, entries=entries))
    return RankingsResponse(categories=tables)


@router.get("/{category}", response_model=RankingTable)
def get_ranking(
    category: RankingCategory,
    db: DbSession,
    _current_player: CurrentPlayer,
) -> RankingTable:
    rows = get_rankings_data(db)[category]
    return RankingTable(
        category=category,
        entries=[
            RankingEntry(
                rank=row.rank,
                player=PlayerSummary(
                    id=row.player.user_id,
                    username=row.player.username,
                    gender=row.player.gender,
                    is_freshman=row.player.is_freshman,
                    club_rank=row.player.club_rank,
                ),
                value=row.value,
            )
            for row in rows
        ],
    )
