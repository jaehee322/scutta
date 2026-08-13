from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import case, func, literal, select, union_all
from sqlalchemy.orm import Session

from app.models import Gender, Match, User, UserRole
from app.schemas.stats import RankingCategory


@dataclass(frozen=True, slots=True)
class PlayerStatsRow:
    user_id: int
    username: str
    gender: Gender | None
    is_freshman: bool
    club_rank: int | None
    matches: int
    wins: int
    losses: int
    opponents: int

    def value_for(self, category: RankingCategory) -> int:
        return int(getattr(self, category.value))


@dataclass(frozen=True, slots=True)
class RankingRow:
    player: PlayerStatsRow
    rank: int
    value: int


def _participant_rows():
    """Normalize each match into one row per participant."""
    return union_all(
        select(
            Match.player1_id.label("user_id"),
            literal(1).label("match_count"),
            case((Match.score1 > Match.score2, 1), else_=0).label("win_count"),
            case((Match.score1 < Match.score2, 1), else_=0).label("loss_count"),
            Match.player2_id.label("opponent_id"),
        ),
        select(
            Match.player2_id.label("user_id"),
            literal(1).label("match_count"),
            case((Match.score2 > Match.score1, 1), else_=0).label("win_count"),
            case((Match.score2 < Match.score1, 1), else_=0).label("loss_count"),
            Match.player1_id.label("opponent_id"),
        ),
    ).subquery("match_participants")


def _stats_select():
    participants = _participant_rows()
    return (
        select(
            User.id.label("user_id"),
            User.username,
            User.gender,
            User.is_freshman,
            User.club_rank,
            func.coalesce(func.sum(participants.c.match_count), 0).label("matches"),
            func.coalesce(func.sum(participants.c.win_count), 0).label("wins"),
            func.coalesce(func.sum(participants.c.loss_count), 0).label("losses"),
            func.count(func.distinct(participants.c.opponent_id)).label("opponents"),
        )
        .select_from(User)
        .outerjoin(participants, participants.c.user_id == User.id)
        .where(User.is_active.is_(True), User.role == UserRole.PLAYER)
        .group_by(
            User.id,
            User.username,
            User.gender,
            User.is_freshman,
            User.club_rank,
        )
    )


def _to_stats_row(row: object) -> PlayerStatsRow:
    return PlayerStatsRow(
        user_id=row.user_id,  # type: ignore[attr-defined]
        username=row.username,  # type: ignore[attr-defined]
        gender=row.gender,  # type: ignore[attr-defined]
        is_freshman=row.is_freshman,  # type: ignore[attr-defined]
        club_rank=row.club_rank,  # type: ignore[attr-defined]
        matches=int(row.matches),  # type: ignore[attr-defined]
        wins=int(row.wins),  # type: ignore[attr-defined]
        losses=int(row.losses),  # type: ignore[attr-defined]
        opponents=int(row.opponents),  # type: ignore[attr-defined]
    )


def list_player_stats(db: Session) -> list[PlayerStatsRow]:
    rows = db.execute(_stats_select().order_by(User.username.asc())).all()
    return [_to_stats_row(row) for row in rows]


def get_player_stats(db: Session, user_id: int) -> PlayerStatsRow | None:
    stats = _stats_select().subquery("player_stats")
    row = db.execute(select(stats).where(stats.c.user_id == user_id)).one_or_none()
    return _to_stats_row(row) if row is not None else None


def get_rankings(db: Session) -> dict[RankingCategory, list[RankingRow]]:
    """Return four descending rankings using SQL RANK (1, 1, 3 ties)."""
    stats = _stats_select().subquery("player_stats")
    ranked = select(
        stats,
        func.rank().over(order_by=stats.c.matches.desc()).label("matches_rank"),
        func.rank().over(order_by=stats.c.wins.desc()).label("wins_rank"),
        func.rank().over(order_by=stats.c.losses.desc()).label("losses_rank"),
        func.rank().over(order_by=stats.c.opponents.desc()).label("opponents_rank"),
    )
    rows = db.execute(ranked).all()

    result: dict[RankingCategory, list[RankingRow]] = {category: [] for category in RankingCategory}
    for row in rows:
        player = _to_stats_row(row)
        for category in RankingCategory:
            result[category].append(
                RankingRow(
                    player=player,
                    rank=int(getattr(row, f"{category.value}_rank")),
                    value=player.value_for(category),
                )
            )

    for category in RankingCategory:
        result[category].sort(key=lambda item: (item.rank, item.player.username.casefold()))
    return result
