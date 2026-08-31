from __future__ import annotations

import enum

from pydantic import BaseModel, ConfigDict, Field


class CoinSide(enum.StrEnum):
    HEADS = "heads"
    TAILS = "tails"


class CoinFlipStateRead(BaseModel):
    active: bool
    run_id: int = Field(ge=0)
    current_streak: int = Field(ge=0)
    best_streak: int = Field(ge=0)


class CoinFlipRankingEntry(BaseModel):
    rank: int = Field(ge=1)
    user_id: int
    username: str
    best_streak: int = Field(ge=0)


class CoinFlipOverview(BaseModel):
    state: CoinFlipStateRead
    ranking: list[CoinFlipRankingEntry]


class CoinFlipRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    choice: CoinSide
    run_id: int = Field(ge=1)
    round_no: int = Field(ge=1, le=1_000_000)


class CoinFlipResponse(CoinFlipOverview):
    result: CoinSide
    correct: bool
    game_over: bool
    final_score: int | None = Field(default=None, ge=0)
