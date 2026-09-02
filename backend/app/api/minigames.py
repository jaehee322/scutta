from __future__ import annotations

from fastapi import APIRouter, HTTPException, status

from app.api.deps import CurrentPlayer, DbSession
from app.models import CoinFlipState
from app.schemas.minigames import (
    CoinFlipOverview,
    CoinFlipRankingEntry,
    CoinFlipRequest,
    CoinFlipResponse,
    CoinFlipStateRead,
)
from app.services.minigames import (
    CoinFlipDailyLimitError,
    CoinFlipNotActiveError,
    CoinFlipRateLimitError,
    CoinFlipRoundConflictError,
    coin_flip_attempts_remaining,
    flip_coin,
    get_coin_flip_state,
    list_coin_flip_rankings,
    start_coin_flip,
)

router = APIRouter(prefix="/minigames/coin-flip", tags=["minigames"])


def _state_read(state: CoinFlipState | None) -> CoinFlipStateRead:
    if state is None:
        return CoinFlipStateRead(
            active=False,
            run_id=0,
            current_streak=0,
            best_streak=0,
            remaining_attempts=coin_flip_attempts_remaining(None),
        )
    return CoinFlipStateRead(
        active=state.active,
        run_id=state.run_id,
        current_streak=state.current_streak,
        best_streak=state.best_streak,
        remaining_attempts=coin_flip_attempts_remaining(state),
    )


def _ranking_read(db: DbSession) -> list[CoinFlipRankingEntry]:
    return [
        CoinFlipRankingEntry(
            rank=row.rank,
            user_id=row.user_id,
            username=row.username,
            best_streak=row.best_streak,
        )
        for row in list_coin_flip_rankings(db)
    ]


@router.get("", response_model=CoinFlipOverview)
def get_coin_flip(db: DbSession, current_player: CurrentPlayer) -> CoinFlipOverview:
    return CoinFlipOverview(
        state=_state_read(get_coin_flip_state(db, user_id=current_player.id)),
        ranking=_ranking_read(db),
    )


@router.post("/start", response_model=CoinFlipOverview)
def start_coin_flip_game(db: DbSession, current_player: CurrentPlayer) -> CoinFlipOverview:
    try:
        state = start_coin_flip(db, user_id=current_player.id)
    except CoinFlipDailyLimitError as error:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(error),
            headers={"Retry-After": str(error.retry_after)},
        ) from error
    return CoinFlipOverview(state=_state_read(state), ranking=_ranking_read(db))


@router.post("/flip", response_model=CoinFlipResponse)
def submit_coin_flip(
    payload: CoinFlipRequest,
    db: DbSession,
    current_player: CurrentPlayer,
) -> CoinFlipResponse:
    try:
        outcome = flip_coin(
            db,
            user_id=current_player.id,
            choice=payload.choice,
            run_id=payload.run_id,
            round_no=payload.round_no,
        )
    except CoinFlipNotActiveError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error
    except CoinFlipRateLimitError as error:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=str(error),
            headers={"Retry-After": "1"},
        ) from error
    except CoinFlipRoundConflictError as error:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(error)) from error

    return CoinFlipResponse(
        result=outcome.result,
        correct=outcome.correct,
        game_over=not outcome.correct,
        final_score=outcome.final_score,
        state=_state_read(outcome.state),
        ranking=_ranking_read(db),
    )
