from __future__ import annotations

import unicodedata
from datetime import date, datetime
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import CompetitionStatus, CompetitionType
from app.schemas.matches import ALLOWED_SCORES


def _strip_name(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("이름을 입력해 주세요.")
    return value


def _unique_ids(values: list[int], *, label: str) -> list[int]:
    if len(values) != len(set(values)):
        raise ValueError(f"{label}에 중복을 사용할 수 없습니다.")
    return values


def team_name_key(value: str) -> str:
    """Match the browser's NFKC + lowercase duplicate-name rule."""
    return unicodedata.normalize("NFKC", value).lower()


class CompetitionPlayer(BaseModel):
    id: int
    username: str
    club_rank: int | None


class CompetitionSummary(BaseModel):
    id: int
    name: str
    type: CompetitionType
    status: CompetitionStatus
    completed_count: int
    total_count: int
    is_participant: bool
    completed_at: datetime | None
    created_at: datetime
    updated_at: datetime


class LeagueStanding(BaseModel):
    rank: int
    player: CompetitionPlayer
    played: int
    wins: int
    losses: int
    sets_won: int
    sets_lost: int
    set_difference: int


class LeagueFixtureRead(BaseModel):
    id: int
    round_no: int
    order_no: int
    player1: CompetitionPlayer
    player2: CompetitionPlayer
    score1: int | None
    score2: int | None
    played_on: date | None
    played_at: datetime | None
    winner_id: int | None
    completed: bool
    can_submit: bool


class LeagueCompetitionDetail(CompetitionSummary):
    type: Literal[CompetitionType.LEAGUE] = CompetitionType.LEAGUE
    members: list[CompetitionPlayer]
    standings: list[LeagueStanding]
    fixtures: list[LeagueFixtureRead]


class CompetitionTeamSummary(BaseModel):
    id: int
    name: str


class CompetitionTeamRead(CompetitionTeamSummary):
    members: list[CompetitionPlayer]


class TeamStanding(BaseModel):
    rank: int
    team: CompetitionTeamSummary
    played: int
    wins: int
    losses: int
    games_won: int
    games_lost: int
    game_difference: int


class TeamSingleRead(BaseModel):
    id: int
    sequence: int
    team1_player: CompetitionPlayer
    team2_player: CompetitionPlayer
    score1: int
    score2: int
    played_on: date
    played_at: datetime | None
    winner_team_id: int


class TeamDoublesRead(BaseModel):
    id: int
    team1_players: list[CompetitionPlayer]
    team2_players: list[CompetitionPlayer]
    score1: int | None
    score2: int | None
    played_on: date | None
    played_at: datetime | None
    winner_team_id: int | None
    completed: bool


class TeamEncounterRead(BaseModel):
    id: int
    round_no: int
    order_no: int
    team1: CompetitionTeamRead
    team2: CompetitionTeamRead
    singles: list[TeamSingleRead]
    doubles: TeamDoublesRead | None
    team1_wins: int
    team2_wins: int
    winner_team_id: int | None
    completed: bool
    available_team1_players: list[CompetitionPlayer]
    available_team2_players: list[CompetitionPlayer]
    can_submit_singles: bool
    can_submit_doubles: bool


class TeamCompetitionDetail(CompetitionSummary):
    type: Literal[CompetitionType.TEAM] = CompetitionType.TEAM
    teams: list[CompetitionTeamRead]
    standings: list[TeamStanding]
    encounters: list[TeamEncounterRead]


CompetitionDetail = Annotated[
    LeagueCompetitionDetail | TeamCompetitionDetail,
    Field(discriminator="type"),
]


class TeamInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=64)
    member_ids: list[int] = Field(min_length=4, max_length=4)

    _normalize_name = field_validator("name")(_strip_name)

    @field_validator("member_ids")
    @classmethod
    def validate_member_ids(cls, values: list[int]) -> list[int]:
        if any(value <= 0 for value in values):
            raise ValueError("선수 ID는 양수여야 합니다.")
        return _unique_ids(values, label="팀 선수")


class TeamNameInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: int = Field(gt=0)
    name: str = Field(min_length=1, max_length=64)

    _normalize_name = field_validator("name")(_strip_name)


class CompetitionCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=100)
    type: CompetitionType
    participant_ids: list[int] | None = Field(default=None, min_length=4, max_length=6)
    teams: list[TeamInput] | None = Field(default=None, min_length=2)

    _normalize_name = field_validator("name")(_strip_name)

    @field_validator("participant_ids")
    @classmethod
    def validate_participant_ids(cls, values: list[int] | None) -> list[int] | None:
        if values is None:
            return None
        if any(value <= 0 for value in values):
            raise ValueError("선수 ID는 양수여야 합니다.")
        return _unique_ids(values, label="참가자")

    @model_validator(mode="after")
    def validate_by_type(self) -> CompetitionCreate:
        if self.type == CompetitionType.LEAGUE:
            if self.participant_ids is None or self.teams is not None:
                raise ValueError("개인 리그에는 participant_ids만 필요합니다.")
        elif self.teams is None or self.participant_ids is not None:
            raise ValueError("단체전에는 teams만 필요합니다.")
        return self


class CompetitionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=100)
    participant_ids: list[int] | None = Field(default=None, min_length=4, max_length=6)
    teams: list[TeamInput] | None = Field(default=None, min_length=2)
    team_names: list[TeamNameInput] | None = Field(default=None, min_length=2)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        return None if value is None else _strip_name(value)

    @field_validator("participant_ids")
    @classmethod
    def validate_participant_ids(cls, values: list[int] | None) -> list[int] | None:
        if values is None:
            return None
        if any(value <= 0 for value in values):
            raise ValueError("선수 ID는 양수여야 합니다.")
        return _unique_ids(values, label="참가자")

    @field_validator("team_names")
    @classmethod
    def validate_team_names(cls, values: list[TeamNameInput] | None) -> list[TeamNameInput] | None:
        if values is None:
            return None
        _unique_ids([team.id for team in values], label="팀 ID")
        normalized_names = [team_name_key(team.name) for team in values]
        if len(normalized_names) != len(set(normalized_names)):
            raise ValueError("팀 이름은 서로 달라야 합니다.")
        return values

    @model_validator(mode="after")
    def validate_patch(self) -> CompetitionUpdate:
        if not self.model_fields_set:
            raise ValueError("수정할 항목을 하나 이상 입력해 주세요.")
        for field_name in self.model_fields_set:
            if getattr(self, field_name) is None:
                raise ValueError(f"{field_name}에는 null을 사용할 수 없습니다.")
        structure_fields = {"participant_ids", "teams", "team_names"} & self.model_fields_set
        if len(structure_fields) > 1:
            raise ValueError("편성 수정 항목은 하나만 사용할 수 있습니다.")
        return self


class ScorePair(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @staticmethod
    def validate_pair(score1: int, score2: int) -> None:
        if (score1, score2) not in ALLOWED_SCORES:
            raise ValueError("점수는 3:0 또는 2:1이어야 합니다.")


class LeagueResultSubmit(ScorePair):
    my_score: int = Field(ge=0, le=3)
    opponent_score: int = Field(ge=0, le=3)

    @model_validator(mode="after")
    def validate_score(self) -> LeagueResultSubmit:
        self.validate_pair(self.my_score, self.opponent_score)
        return self


class TeamSingleSubmit(ScorePair):
    my_team_player_id: int = Field(gt=0)
    opponent_team_player_id: int = Field(gt=0)
    my_team_score: int = Field(ge=0, le=3)
    opponent_team_score: int = Field(ge=0, le=3)

    @model_validator(mode="after")
    def validate_score(self) -> TeamSingleSubmit:
        self.validate_pair(self.my_team_score, self.opponent_team_score)
        return self


class TeamDoublesSubmit(ScorePair):
    my_team_score: int = Field(ge=0, le=3)
    opponent_team_score: int = Field(ge=0, le=3)

    @model_validator(mode="after")
    def validate_score(self) -> TeamDoublesSubmit:
        self.validate_pair(self.my_team_score, self.opponent_team_score)
        return self


class AdminLeagueResult(ScorePair):
    score1: int = Field(ge=0, le=3)
    score2: int = Field(ge=0, le=3)
    played_on: date | None = None

    @model_validator(mode="after")
    def validate_score(self) -> AdminLeagueResult:
        self.validate_pair(self.score1, self.score2)
        return self


class AdminTeamSingleResult(AdminLeagueResult):
    team1_player_id: int = Field(gt=0)
    team2_player_id: int = Field(gt=0)


class AdminTeamDoublesResult(AdminLeagueResult):
    pass
