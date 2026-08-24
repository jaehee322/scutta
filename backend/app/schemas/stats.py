from __future__ import annotations

import enum

from pydantic import BaseModel

from app.models import Gender


class RankingCategory(enum.StrEnum):
    MATCHES = "matches"
    WINS = "wins"
    LOSSES = "losses"
    OPPONENTS = "opponents"


class SettlementCategoryKey(enum.StrEnum):
    MATCHES = "matches"
    WINS = "wins"
    LOSSES = "losses"


class PlayerSummary(BaseModel):
    id: int
    username: str
    gender: Gender | None
    is_freshman: bool
    club_rank: int | None


class PlayerStats(BaseModel):
    matches: int
    wins: int
    losses: int
    opponents: int


class PlayerWithStats(PlayerSummary):
    stats: PlayerStats


class RankingEntry(BaseModel):
    rank: int
    player: PlayerSummary
    value: int


class RankingTable(BaseModel):
    category: RankingCategory
    entries: list[RankingEntry]


class RankingsResponse(BaseModel):
    categories: list[RankingTable]


class SettlementCategory(BaseModel):
    category: SettlementCategoryKey
    prize: str
    value: int
    tickets: int
    total_tickets: int
    probability_percent: float


class SettlementResponse(BaseModel):
    draws: list[str]
    categories: list[SettlementCategory]
