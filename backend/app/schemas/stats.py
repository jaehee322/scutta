from __future__ import annotations

import enum

from pydantic import BaseModel, Field

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


class SettlementDistributionEntry(BaseModel):
    player_id: int
    username: str
    tickets: int = Field(ge=1)
    probability_percent: float = Field(ge=0, le=100)
    rank: int = Field(ge=1)


class SettlementDistribution(SettlementCategory):
    holder_count: int = Field(ge=0)
    entries: list[SettlementDistributionEntry]


class SettlementResponse(BaseModel):
    draws: list[str]
    categories: list[SettlementCategory]
