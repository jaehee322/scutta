from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_player
from app.core.database import get_db
from app.models import User, UserRole
from app.schemas.stats import PlayerStats, PlayerSummary, PlayerWithStats
from app.services.stats import get_player_stats

router = APIRouter(prefix="/players", tags=["players"])

DbSession = Annotated[Session, Depends(get_db)]
CurrentPlayer = Annotated[User, Depends(get_current_player)]


def _player_summary(user: User) -> PlayerSummary:
    return PlayerSummary(
        id=user.id,
        username=user.username,
        gender=user.gender,
        is_freshman=user.is_freshman,
        club_rank=user.club_rank,
    )


@router.get("", response_model=list[PlayerSummary])
def list_players(
    db: DbSession,
    current_player: CurrentPlayer,
    exclude_self: bool = Query(default=False),
) -> list[PlayerSummary]:
    query = select(User).where(User.role == UserRole.PLAYER).order_by(User.username.asc())
    if exclude_self:
        query = query.where(User.id != current_player.id)
    return [_player_summary(user) for user in db.scalars(query).all()]


@router.get("/me", response_model=PlayerWithStats)
def get_my_player(db: DbSession, current_player: CurrentPlayer) -> PlayerWithStats:
    stats_row = get_player_stats(db, current_player.id)
    if stats_row is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="player not found")
    return PlayerWithStats(
        **_player_summary(current_player).model_dump(),
        stats=PlayerStats(
            matches=stats_row.matches,
            wins=stats_row.wins,
            losses=stats_row.losses,
            opponents=stats_row.opponents,
        ),
    )
