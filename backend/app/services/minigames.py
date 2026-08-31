from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import timedelta

from sqlalchemy import case, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import utc_now
from app.models import CoinFlipState, User, UserRole
from app.schemas.minigames import CoinSide


class CoinFlipNotActiveError(Exception):
    pass


class CoinFlipRoundConflictError(Exception):
    pass


class CoinFlipRateLimitError(Exception):
    pass


@dataclass(frozen=True, slots=True)
class CoinFlipRankingRow:
    rank: int
    user_id: int
    username: str
    best_streak: int


@dataclass(frozen=True, slots=True)
class CoinFlipOutcome:
    state: CoinFlipState
    result: CoinSide
    correct: bool
    final_score: int | None


def get_coin_flip_state(db: Session, *, user_id: int) -> CoinFlipState | None:
    return db.get(CoinFlipState, user_id)


def list_coin_flip_rankings(db: Session) -> list[CoinFlipRankingRow]:
    rows = db.execute(
        select(
            CoinFlipState.user_id,
            User.username,
            CoinFlipState.best_streak,
        )
        .join(User, User.id == CoinFlipState.user_id)
        .where(User.role == UserRole.PLAYER)
        .order_by(
            CoinFlipState.best_streak.desc(),
            case((CoinFlipState.best_achieved_at.is_(None), 1), else_=0),
            CoinFlipState.best_achieved_at.asc(),
            User.username.asc(),
            User.id.asc(),
        )
    ).all()

    ranking: list[CoinFlipRankingRow] = []
    previous_score: int | None = None
    dense_rank = 0
    for row in rows:
        score = int(row.best_streak)
        if previous_score is None or score != previous_score:
            dense_rank += 1
            previous_score = score
        ranking.append(
            CoinFlipRankingRow(
                rank=dense_rank,
                user_id=row.user_id,
                username=row.username,
                best_streak=score,
            )
        )
    return ranking


def start_coin_flip(db: Session, *, user_id: int) -> CoinFlipState:
    """Start a run, or resume the currently active run without resetting it."""
    statement = (
        update(CoinFlipState)
        .where(CoinFlipState.user_id == user_id)
        .values(
            active=True,
            run_id=case(
                (CoinFlipState.active.is_(False), CoinFlipState.run_id + 1),
                else_=CoinFlipState.run_id,
            ),
            current_streak=case(
                (CoinFlipState.active.is_(False), 0),
                else_=CoinFlipState.current_streak,
            ),
        )
        .returning(CoinFlipState)
        .execution_options(synchronize_session=False)
    )
    state = db.execute(statement).scalar_one_or_none()
    if state is not None:
        db.commit()
        return state

    state = CoinFlipState(
        user_id=user_id,
        active=True,
        run_id=1,
        current_streak=0,
        best_streak=0,
        best_achieved_at=None,
        last_flip_at=None,
    )
    db.add(state)
    try:
        db.commit()
    except IntegrityError:
        # Two first-start requests can race on the user_id primary key. The
        # winner created the only valid state, so the loser resumes that state.
        db.rollback()
        state = db.get(CoinFlipState, user_id)
        if state is None:
            raise
    return state


def flip_coin(
    db: Session,
    *,
    user_id: int,
    choice: CoinSide,
    run_id: int,
    round_no: int,
) -> CoinFlipOutcome:
    result_side = CoinSide.TAILS if secrets.randbits(1) else CoinSide.HEADS
    correct = choice == result_side
    now = utc_now()
    rate_limit_cutoff = now - timedelta(milliseconds=700)

    conditions = (
        CoinFlipState.user_id == user_id,
        CoinFlipState.active.is_(True),
        CoinFlipState.run_id == run_id,
        CoinFlipState.current_streak == round_no - 1,
        or_(
            CoinFlipState.last_flip_at.is_(None),
            CoinFlipState.last_flip_at <= rate_limit_cutoff,
        ),
    )
    if correct:
        statement = (
            update(CoinFlipState)
            .where(*conditions)
            .values(
                current_streak=round_no,
                best_streak=case(
                    (round_no > CoinFlipState.best_streak, round_no),
                    else_=CoinFlipState.best_streak,
                ),
                best_achieved_at=case(
                    (round_no > CoinFlipState.best_streak, now),
                    else_=CoinFlipState.best_achieved_at,
                ),
                last_flip_at=now,
            )
            .returning(CoinFlipState)
            .execution_options(synchronize_session=False)
        )
        final_score = None
    else:
        statement = (
            update(CoinFlipState)
            .where(*conditions)
            .values(active=False, current_streak=0, last_flip_at=now)
            .returning(CoinFlipState)
            .execution_options(synchronize_session=False)
        )
        final_score = round_no - 1

    state = db.execute(statement).scalar_one_or_none()
    if state is None:
        db.rollback()
        current = db.get(CoinFlipState, user_id)
        if current is None or not current.active:
            raise CoinFlipNotActiveError("진행 중인 동전 던지기 게임이 없습니다.")
        if current.run_id == run_id and current.current_streak == round_no - 1:
            raise CoinFlipRateLimitError("동전은 0.7초에 한 번만 던질 수 있습니다.")
        raise CoinFlipRoundConflictError(
            "이미 처리되었거나 현재 순서와 맞지 않는 라운드입니다."
        )

    db.commit()
    return CoinFlipOutcome(
        state=state,
        result=result_side,
        correct=correct,
        final_score=final_score,
    )
