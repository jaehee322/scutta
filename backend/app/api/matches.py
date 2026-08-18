from __future__ import annotations

from datetime import date
from typing import Annotated, NoReturn

from fastapi import APIRouter, HTTPException, Query, Response, status

from app.api.deps import CurrentAdmin, CurrentPlayer, DbSession
from app.schemas.matches import (
    MatchAdminUpdate,
    MatchCreate,
    MatchListResponse,
    MatchParticipant,
    MatchRead,
)
from app.services.matches import (
    CompetitionMatchManagedError,
    DailyMatchConflictError,
    InvalidMatchError,
    MatchNotFoundError,
    MatchRecord,
    PlayerNotFoundError,
    create_player_match,
    delete_match,
    list_match_records,
    update_match,
)

router = APIRouter(prefix="/matches", tags=["matches"])
admin_router = APIRouter(prefix="/admin/matches", tags=["admin:matches"])


def _match_read(record: MatchRecord) -> MatchRead:
    match = record.match
    winner_id = match.player1_id if match.score1 > match.score2 else match.player2_id
    loser_id = match.player2_id if winner_id == match.player1_id else match.player1_id
    return MatchRead(
        id=match.id,
        player1=MatchParticipant(id=match.player1_id, username=record.player1_username),
        player2=MatchParticipant(id=match.player2_id, username=record.player2_username),
        score1=match.score1,
        score2=match.score2,
        winner_id=winner_id,
        loser_id=loser_id,
        kind=match.kind,
        played_on=match.played_on,
        submitted_by_id=match.submitted_by_id,
        updated_by_id=match.updated_by_id,
        created_at=match.created_at,
        updated_at=match.updated_at,
    )


def _raise_match_error(error: Exception) -> NoReturn:
    if isinstance(error, MatchNotFoundError | PlayerNotFoundError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    if isinstance(error, DailyMatchConflictError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    if isinstance(error, CompetitionMatchManagedError):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    if isinstance(error, InvalidMatchError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(error),
        ) from error
    raise error


def _validate_date_range(played_from: date | None, played_to: date | None) -> None:
    if played_from is not None and played_to is not None and played_from > played_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="played_from must not be after played_to",
        )


@router.post("", response_model=MatchRead, status_code=status.HTTP_201_CREATED)
def submit_match(
    payload: MatchCreate,
    db: DbSession,
    current_player: CurrentPlayer,
) -> MatchRead:
    try:
        record = create_player_match(
            db,
            submitter=current_player,
            opponent_id=payload.opponent_id,
            my_score=payload.my_score,
            opponent_score=payload.opponent_score,
        )
    except (DailyMatchConflictError, InvalidMatchError, PlayerNotFoundError) as error:
        _raise_match_error(error)
    return _match_read(record)


@router.get("", response_model=MatchListResponse)
def list_my_matches(
    db: DbSession,
    current_player: CurrentPlayer,
    played_from: Annotated[date | None, Query()] = None,
    played_to: Annotated[date | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> MatchListResponse:
    _validate_date_range(played_from, played_to)
    records, total = list_match_records(
        db,
        participant_id=current_player.id,
        played_from=played_from,
        played_to=played_to,
        limit=limit,
        offset=offset,
    )
    return MatchListResponse(
        items=[_match_read(record) for record in records],
        total=total,
        limit=limit,
        offset=offset,
    )


@admin_router.get("", response_model=MatchListResponse)
def list_all_matches(
    db: DbSession,
    _admin: CurrentAdmin,
    participant_id: Annotated[int | None, Query(gt=0)] = None,
    played_from: Annotated[date | None, Query()] = None,
    played_to: Annotated[date | None, Query()] = None,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> MatchListResponse:
    _validate_date_range(played_from, played_to)
    records, total = list_match_records(
        db,
        participant_id=participant_id,
        played_from=played_from,
        played_to=played_to,
        limit=limit,
        offset=offset,
        casual_only=True,
    )
    return MatchListResponse(
        items=[_match_read(record) for record in records],
        total=total,
        limit=limit,
        offset=offset,
    )


@admin_router.patch("/{match_id}", response_model=MatchRead)
def patch_match(
    match_id: int,
    payload: MatchAdminUpdate,
    db: DbSession,
    admin: CurrentAdmin,
) -> MatchRead:
    try:
        record = update_match(
            db,
            match_id=match_id,
            changes=payload.model_dump(exclude_unset=True),
            admin=admin,
        )
    except (
        DailyMatchConflictError,
        CompetitionMatchManagedError,
        InvalidMatchError,
        MatchNotFoundError,
        PlayerNotFoundError,
    ) as error:
        _raise_match_error(error)
    return _match_read(record)


@admin_router.delete("/{match_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_match(match_id: int, db: DbSession, _admin: CurrentAdmin) -> Response:
    try:
        delete_match(db, match_id=match_id)
    except (MatchNotFoundError, CompetitionMatchManagedError) as error:
        _raise_match_error(error)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
