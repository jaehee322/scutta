from __future__ import annotations

import secrets
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from math import ceil
from zoneinfo import ZoneInfo

from sqlalchemy import case, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.security import utc_now
from app.models import CoinFlipState, PaddleFlightScore, User, UserRole
from app.schemas.minigames import PADDLE_FLIGHT_MAX_SCORE, CoinSide


class CoinFlipNotActiveError(Exception):
    pass


class CoinFlipRoundConflictError(Exception):
    pass


class CoinFlipRateLimitError(Exception):
    pass


class CoinFlipDailyLimitError(Exception):
    def __init__(self, message: str, *, retry_after: int) -> None:
        super().__init__(message)
        self.retry_after = retry_after


COIN_FLIP_DAILY_ATTEMPT_LIMIT = 20
KOREA_TIME_ZONE = ZoneInfo("Asia/Seoul")
PADDLE_FLIGHT_SUBMISSION_INTERVAL = timedelta(milliseconds=700)


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


@dataclass(frozen=True, slots=True)
class PaddleFlightRankingRow:
    rank: int
    user_id: int
    username: str
    best_score: int


def get_coin_flip_state(db: Session, *, user_id: int) -> CoinFlipState | None:
    return db.get(CoinFlipState, user_id)


def coin_flip_attempts_remaining(
    state: CoinFlipState | None, *, now: datetime | None = None
) -> int:
    today = _korea_today(now or utc_now())
    if state is None or state.daily_attempt_date != today:
        return COIN_FLIP_DAILY_ATTEMPT_LIMIT
    return max(0, COIN_FLIP_DAILY_ATTEMPT_LIMIT - state.daily_attempts_used)


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
    for rank, row in enumerate(rows, start=1):
        score = int(row.best_streak)
        ranking.append(
            CoinFlipRankingRow(
                rank=rank,
                user_id=row.user_id,
                username=row.username,
                best_streak=score,
            )
        )
    return ranking


def get_paddle_flight_score(db: Session, *, user_id: int) -> PaddleFlightScore | None:
    return db.get(PaddleFlightScore, user_id)


def list_paddle_flight_rankings(db: Session) -> list[PaddleFlightRankingRow]:
    rows = db.execute(
        select(
            PaddleFlightScore.user_id,
            User.username,
            PaddleFlightScore.best_score,
        )
        .join(User, User.id == PaddleFlightScore.user_id)
        .where(User.role == UserRole.PLAYER)
        .order_by(
            PaddleFlightScore.best_score.desc(),
            case((PaddleFlightScore.best_achieved_at.is_(None), 1), else_=0),
            PaddleFlightScore.best_achieved_at.asc(),
            User.username.asc(),
            User.id.asc(),
        )
    ).all()

    return [
        PaddleFlightRankingRow(
            rank=rank,
            user_id=row.user_id,
            username=row.username,
            best_score=int(row.best_score),
        )
        for rank, row in enumerate(rows, start=1)
    ]


def submit_paddle_flight_score(
    db: Session,
    *,
    user_id: int,
    score: int,
) -> PaddleFlightScore:
    if not 0 <= score <= PADDLE_FLIGHT_MAX_SCORE:
        raise ValueError("score is outside the accepted range")

    now = utc_now()
    rate_limit_cutoff = now - PADDLE_FLIGHT_SUBMISSION_INTERVAL
    statement = (
        update(PaddleFlightScore)
        .where(
            PaddleFlightScore.user_id == user_id,
            or_(
                PaddleFlightScore.last_submitted_at.is_(None),
                PaddleFlightScore.last_submitted_at <= rate_limit_cutoff,
                # Never discard a newly achieved high score merely because a
                # duplicate/lower submission consumed the short spam window.
                score > PaddleFlightScore.best_score,
            ),
        )
        .values(
            best_score=case(
                (score > PaddleFlightScore.best_score, score),
                else_=PaddleFlightScore.best_score,
            ),
            best_achieved_at=case(
                (score > PaddleFlightScore.best_score, now),
                else_=PaddleFlightScore.best_achieved_at,
            ),
            last_submitted_at=now,
        )
        .returning(PaddleFlightScore)
        .execution_options(synchronize_session=False)
    )
    state = db.execute(statement).scalar_one_or_none()
    if state is not None:
        db.commit()
        return state

    db.rollback()
    existing = db.get(PaddleFlightScore, user_id)
    if existing is not None:
        # Coalesce rapid duplicate/lower submissions without turning an
        # unlimited quick retry into a visible client error.
        return existing
    # Release the read transaction before attempting the first insert. This
    # avoids a SQLite shared-to-write lock upgrade when two first scores arrive
    # together; the primary key still resolves the cross-database race below.
    db.rollback()

    state = PaddleFlightScore(
        user_id=user_id,
        best_score=score,
        best_achieved_at=now if score > 0 else None,
        last_submitted_at=now,
    )
    db.add(state)
    try:
        db.commit()
    except IntegrityError:
        # Concurrent first submissions race on the user primary key. Retry the
        # atomic path so a higher concurrent score is never lost; equal/lower
        # submissions are coalesced after the interval blocks their write.
        db.rollback()
        concurrent = db.execute(statement).scalar_one_or_none()
        if concurrent is not None:
            db.commit()
            return concurrent
        db.rollback()
        existing = db.get(PaddleFlightScore, user_id)
        if existing is None:
            raise
        return existing
    return state


def start_coin_flip(db: Session, *, user_id: int) -> CoinFlipState:
    """Start a run, or resume the currently active run without resetting it."""
    now = utc_now()
    today = _korea_today(now)
    same_attempt_day = CoinFlipState.daily_attempt_date == today
    statement = (
        update(CoinFlipState)
        .where(
            CoinFlipState.user_id == user_id,
            or_(
                CoinFlipState.active.is_(True),
                CoinFlipState.daily_attempt_date.is_(None),
                CoinFlipState.daily_attempt_date != today,
                CoinFlipState.daily_attempts_used < COIN_FLIP_DAILY_ATTEMPT_LIMIT,
            ),
        )
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
            daily_attempt_date=case(
                (CoinFlipState.active.is_(False), today),
                else_=CoinFlipState.daily_attempt_date,
            ),
            daily_attempts_used=case(
                (
                    CoinFlipState.active.is_(False),
                    case(
                        (same_attempt_day, CoinFlipState.daily_attempts_used + 1),
                        else_=1,
                    ),
                ),
                else_=CoinFlipState.daily_attempts_used,
            ),
        )
        .returning(CoinFlipState)
        .execution_options(synchronize_session=False)
    )
    state = db.execute(statement).scalar_one_or_none()
    if state is not None:
        db.commit()
        return state

    db.rollback()
    state = db.get(CoinFlipState, user_id)
    if (
        state is not None
        and not state.active
        and state.daily_attempt_date == today
        and state.daily_attempts_used >= COIN_FLIP_DAILY_ATTEMPT_LIMIT
    ):
        raise CoinFlipDailyLimitError(
            "오늘의 동전 던지기 시도 20회를 모두 사용했습니다.",
            retry_after=_seconds_until_next_korea_day(now),
        )

    state = CoinFlipState(
        user_id=user_id,
        active=True,
        run_id=1,
        current_streak=0,
        best_streak=0,
        best_achieved_at=None,
        last_flip_at=None,
        daily_attempt_date=today,
        daily_attempts_used=1,
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
        if not state.active:
            return start_coin_flip(db, user_id=user_id)
    return state


def _korea_today(now: datetime) -> date:
    return now.astimezone(KOREA_TIME_ZONE).date()


def _seconds_until_next_korea_day(now: datetime) -> int:
    korea_now = now.astimezone(KOREA_TIME_ZONE)
    next_midnight = datetime.combine(
        korea_now.date() + timedelta(days=1), time.min, tzinfo=KOREA_TIME_ZONE
    )
    return max(1, ceil((next_midnight - korea_now).total_seconds()))


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
