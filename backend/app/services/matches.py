from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from sqlalchemy import func, or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased
from sqlalchemy.orm.exc import StaleDataError

from app.models import Match, MatchKind, User, UserRole

SEOUL = ZoneInfo("Asia/Seoul")
ALLOWED_SCORE_PAIRS = {(3, 0), (0, 3), (2, 1), (1, 2)}
DAILY_PAIR_CONSTRAINT = "daily_player_pair"
POSTGRES_UNIQUE_VIOLATION = "23505"
POSTGRES_FOREIGN_KEY_VIOLATION = "23503"
SQLITE_DAILY_PAIR_COLUMNS = {
    "matches.played_on",
    "matches.player1_id",
    "matches.player2_id",
}


class MatchServiceError(Exception):
    """Base class for expected match-domain errors."""


class MatchNotFoundError(MatchServiceError):
    pass


class PlayerNotFoundError(MatchServiceError):
    pass


class InvalidMatchError(MatchServiceError):
    pass


class DailyMatchConflictError(MatchServiceError):
    pass


@dataclass(frozen=True, slots=True)
class MatchRecord:
    match: Match
    player1_username: str
    player2_username: str


def seoul_today() -> date:
    return datetime.now(SEOUL).date()


def _canonicalize(
    player_a_id: int,
    player_b_id: int,
    player_a_score: int,
    player_b_score: int,
) -> tuple[int, int, int, int]:
    if player_a_id == player_b_id:
        raise InvalidMatchError("players must be different")
    if (player_a_score, player_b_score) not in ALLOWED_SCORE_PAIRS:
        raise InvalidMatchError("score must be 3:0 or 2:1 in either direction")
    if player_a_id < player_b_id:
        return player_a_id, player_b_id, player_a_score, player_b_score
    return player_b_id, player_a_id, player_b_score, player_a_score


def _ensure_players(
    db: Session,
    player_ids: set[int],
) -> None:
    query = select(User.id).where(User.id.in_(player_ids), User.role == UserRole.PLAYER)
    query = query.order_by(User.id).with_for_update()
    existing_ids = set(db.scalars(query).all())
    if existing_ids != player_ids:
        raise PlayerNotFoundError("one or more players do not exist or are unavailable")


def _postgres_constraint_name(error: IntegrityError) -> str | None:
    diagnostic = getattr(error.orig, "diag", None)
    constraint_name = getattr(diagnostic, "constraint_name", None)
    return constraint_name if isinstance(constraint_name, str) else None


def _postgres_sqlstate(error: IntegrityError) -> str | None:
    sqlstate = getattr(error.orig, "sqlstate", None) or getattr(error.orig, "pgcode", None)
    return sqlstate if isinstance(sqlstate, str) else None


def _is_sqlite_daily_pair_violation(error: IntegrityError) -> bool:
    if not isinstance(error.orig, sqlite3.IntegrityError):
        return False
    prefix = "unique constraint failed:"
    message = str(error.orig).strip().casefold()
    if not message.startswith(prefix):
        return False
    columns = {column.strip() for column in message[len(prefix) :].split(",")}
    return columns == SQLITE_DAILY_PAIR_COLUMNS


def _is_sqlite_foreign_key_violation(error: IntegrityError) -> bool:
    if not isinstance(error.orig, sqlite3.IntegrityError):
        return False
    error_code = getattr(error.orig, "sqlite_errorcode", None)
    if error_code == sqlite3.SQLITE_CONSTRAINT_FOREIGNKEY:
        return True
    return str(error.orig).strip().casefold() == "foreign key constraint failed"


def _classify_integrity_error(error: IntegrityError) -> MatchServiceError | None:
    """Translate only known database constraints into public domain errors."""
    sqlstate = _postgres_sqlstate(error)
    if (
        sqlstate == POSTGRES_UNIQUE_VIOLATION
        and _postgres_constraint_name(error) == DAILY_PAIR_CONSTRAINT
    ) or _is_sqlite_daily_pair_violation(error):
        return DailyMatchConflictError("this pair already has a match on that date")
    if sqlstate == POSTGRES_FOREIGN_KEY_VIOLATION or _is_sqlite_foreign_key_violation(error):
        return PlayerNotFoundError("one or more players do not exist or are unavailable")
    return None


def _raise_classified_integrity_error(error: IntegrityError) -> None:
    translated = _classify_integrity_error(error)
    if translated is not None:
        raise translated from error


def _get_match_for_update(db: Session, match_id: int) -> Match:
    match = db.scalar(
        select(Match)
        .where(Match.id == match_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if match is None:
        raise MatchNotFoundError("match not found")
    return match


def _ensure_pair_available(
    db: Session,
    *,
    played_on: date,
    player1_id: int,
    player2_id: int,
    exclude_match_id: int | None = None,
) -> None:
    query = select(Match.id).where(
        Match.played_on == played_on,
        Match.player1_id == player1_id,
        Match.player2_id == player2_id,
    )
    if exclude_match_id is not None:
        query = query.where(Match.id != exclude_match_id)
    if db.scalar(query.limit(1)) is not None:
        raise DailyMatchConflictError("this pair already has a match on that date")


def _record_select():
    player1 = aliased(User, name="player1")
    player2 = aliased(User, name="player2")
    return (
        select(
            Match,
            player1.username.label("player1_username"),
            player2.username.label("player2_username"),
        )
        .join(player1, Match.player1_id == player1.id)
        .join(player2, Match.player2_id == player2.id)
    )


def get_match_record(db: Session, match_id: int) -> MatchRecord:
    row = db.execute(_record_select().where(Match.id == match_id)).one_or_none()
    if row is None:
        raise MatchNotFoundError("match not found")
    match, player1_username, player2_username = row
    return MatchRecord(
        match=match,
        player1_username=player1_username,
        player2_username=player2_username,
    )


def create_player_match(
    db: Session,
    *,
    submitter: User,
    opponent_id: int,
    my_score: int,
    opponent_score: int,
) -> MatchRecord:
    _ensure_players(db, {submitter.id, opponent_id})
    player1_id, player2_id, score1, score2 = _canonicalize(
        submitter.id,
        opponent_id,
        my_score,
        opponent_score,
    )
    played_on = seoul_today()
    _ensure_pair_available(
        db,
        played_on=played_on,
        player1_id=player1_id,
        player2_id=player2_id,
    )

    match = Match(
        player1_id=player1_id,
        player2_id=player2_id,
        score1=score1,
        score2=score2,
        kind=MatchKind.CASUAL,
        played_on=played_on,
        submitted_by_id=submitter.id,
    )
    db.add(match)
    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        _raise_classified_integrity_error(error)
        raise
    db.refresh(match)
    return get_match_record(db, match.id)


def list_match_records(
    db: Session,
    *,
    participant_id: int | None = None,
    played_from: date | None = None,
    played_to: date | None = None,
    limit: int,
    offset: int,
) -> tuple[list[MatchRecord], int]:
    filters = []
    if participant_id is not None:
        filters.append(or_(Match.player1_id == participant_id, Match.player2_id == participant_id))
    if played_from is not None:
        filters.append(Match.played_on >= played_from)
    if played_to is not None:
        filters.append(Match.played_on <= played_to)

    total = int(db.scalar(select(func.count(Match.id)).where(*filters)) or 0)
    rows = db.execute(
        _record_select()
        .where(*filters)
        .order_by(Match.played_on.desc(), Match.created_at.desc(), Match.id.desc())
        .limit(limit)
        .offset(offset)
    ).all()
    records = [
        MatchRecord(match=row[0], player1_username=row[1], player2_username=row[2]) for row in rows
    ]
    return records, total


def update_match(
    db: Session,
    *,
    match_id: int,
    changes: dict[str, object],
    admin: User,
) -> MatchRecord:
    match = _get_match_for_update(db, match_id)

    player1_id = match.player1_id
    player2_id = match.player2_id
    score1 = match.score1
    score2 = match.score2

    if "player1_id" in changes:
        supplied_player1_id = int(changes["player1_id"])
        supplied_player2_id = int(changes["player2_id"])
        supplied_score1 = int(changes["score1"])
        supplied_score2 = int(changes["score2"])
        player1_id, player2_id, score1, score2 = _canonicalize(
            supplied_player1_id,
            supplied_player2_id,
            supplied_score1,
            supplied_score2,
        )
        _ensure_players(db, {player1_id, player2_id})
    elif "score1" in changes:
        score1 = int(changes["score1"])
        score2 = int(changes["score2"])
        if (score1, score2) not in ALLOWED_SCORE_PAIRS:
            raise InvalidMatchError("score must be 3:0 or 2:1 in either direction")

    played_on = changes.get("played_on", match.played_on)
    if not isinstance(played_on, date):
        raise InvalidMatchError("played_on is invalid")

    _ensure_pair_available(
        db,
        played_on=played_on,
        player1_id=player1_id,
        player2_id=player2_id,
        exclude_match_id=match.id,
    )

    match.player1_id = player1_id
    match.player2_id = player2_id
    match.score1 = score1
    match.score2 = score2
    match.played_on = played_on
    if "kind" in changes:
        match.kind = changes["kind"]  # type: ignore[assignment]
    match.updated_by_id = admin.id

    try:
        db.commit()
    except IntegrityError as error:
        db.rollback()
        _raise_classified_integrity_error(error)
        raise
    except StaleDataError as error:
        db.rollback()
        raise MatchNotFoundError("match no longer exists") from error
    db.refresh(match)
    return get_match_record(db, match.id)


def delete_match(db: Session, *, match_id: int) -> None:
    match = _get_match_for_update(db, match_id)
    db.delete(match)
    try:
        db.commit()
    except StaleDataError as error:
        db.rollback()
        raise MatchNotFoundError("match no longer exists") from error
