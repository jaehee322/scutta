from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select

from app.api.deps import CurrentPlayer, DbSession
from app.api.matches import match_read
from app.models import User, UserRole
from app.schemas.matches import PlayerMatchListResponse
from app.schemas.stats import PlayerStats, PlayerSummary, PlayerWithStats
from app.services.matches import PlayerNotFoundError, list_player_match_history
from app.services.stats import get_player_stats

router = APIRouter(prefix="/players", tags=["players"])


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


@router.get("/{player_id}/matches", response_model=PlayerMatchListResponse)
def get_player_matches(
    player_id: int,
    db: DbSession,
    current_player: CurrentPlayer,
    head_to_head: bool = False,
    limit: Annotated[int, Query(ge=1, le=200)] = 5,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> PlayerMatchListResponse:
    try:
        history = list_player_match_history(
            db,
            player_id=player_id,
            viewer_id=current_player.id,
            head_to_head=head_to_head,
            limit=limit,
            offset=offset,
        )
    except PlayerNotFoundError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    return PlayerMatchListResponse(
        items=[match_read(record) for record in history.records],
        total=history.total,
        limit=limit,
        offset=offset,
        wins=history.wins,
        losses=history.losses,
    )
