from __future__ import annotations

from datetime import date, datetime

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.models import MatchKind

ALLOWED_SCORES = {(3, 0), (0, 3), (2, 1), (1, 2)}


def _is_allowed_score(score1: int, score2: int) -> bool:
    return (score1, score2) in ALLOWED_SCORES


class MatchCreate(BaseModel):
    opponent_id: int = Field(gt=0)
    my_score: int = Field(ge=0, le=3)
    opponent_score: int = Field(ge=0, le=3)

    @model_validator(mode="after")
    def validate_score(self) -> MatchCreate:
        if not _is_allowed_score(self.my_score, self.opponent_score):
            raise ValueError("score must be 3:0 or 2:1 in either direction")
        return self


class MatchAdminUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    player1_id: int | None = Field(default=None, gt=0)
    player2_id: int | None = Field(default=None, gt=0)
    score1: int | None = Field(default=None, ge=0, le=3)
    score2: int | None = Field(default=None, ge=0, le=3)
    played_on: date | None = None

    @model_validator(mode="after")
    def validate_patch(self) -> MatchAdminUpdate:
        fields = self.model_fields_set
        if not fields:
            raise ValueError("at least one field is required")

        player_fields = {"player1_id", "player2_id"}
        score_fields = {"score1", "score2"}

        if fields & player_fields and not player_fields <= fields:
            raise ValueError("player1_id and player2_id must be updated together")
        if fields & score_fields and not score_fields <= fields:
            raise ValueError("score1 and score2 must be updated together")
        if fields & player_fields and not score_fields <= fields:
            raise ValueError("scores are required when players are changed")

        if player_fields <= fields:
            if self.player1_id is None or self.player2_id is None:
                raise ValueError("player ids cannot be null")
            if self.player1_id == self.player2_id:
                raise ValueError("players must be different")

        if score_fields <= fields:
            if self.score1 is None or self.score2 is None:
                raise ValueError("scores cannot be null")
            if not _is_allowed_score(self.score1, self.score2):
                raise ValueError("score must be 3:0 or 2:1 in either direction")

        if "played_on" in fields and self.played_on is None:
            raise ValueError("played_on cannot be null")
        return self


class MatchParticipant(BaseModel):
    id: int
    username: str


class MatchRead(BaseModel):
    id: int
    player1: MatchParticipant
    player2: MatchParticipant
    score1: int
    score2: int
    winner_id: int
    loser_id: int
    kind: MatchKind
    played_on: date
    played_at: datetime | None


class MatchListResponse(BaseModel):
    items: list[MatchRead]
    total: int
    limit: int
    offset: int
