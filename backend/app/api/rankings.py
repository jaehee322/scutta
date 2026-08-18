from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import CurrentPlayer, DbSession
from app.schemas.stats import (
    PlayerSummary,
    RankingCategory,
    RankingEntry,
    RankingsResponse,
    RankingTable,
)
from app.services.stats import RankingRow
from app.services.stats import get_rankings as get_rankings_data

router = APIRouter(prefix="/rankings", tags=["rankings"])


def _ranking_table(category: RankingCategory, rows: list[RankingRow]) -> RankingTable:
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


@router.get("", response_model=RankingsResponse)
def get_rankings(db: DbSession, _current_player: CurrentPlayer) -> RankingsResponse:
    rankings = get_rankings_data(db)
    return RankingsResponse(
        categories=[_ranking_table(category, rankings[category]) for category in RankingCategory]
    )


@router.get("/{category}", response_model=RankingTable)
def get_ranking(
    category: RankingCategory,
    db: DbSession,
    _current_player: CurrentPlayer,
) -> RankingTable:
    return _ranking_table(category, get_rankings_data(db)[category])
