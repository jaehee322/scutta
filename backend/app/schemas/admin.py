from __future__ import annotations

from enum import StrEnum

from pydantic import BaseModel, Field

DATABASE_RESET_CONFIRMATION = "모든 경기, 대회와 선수 데이터를 삭제합니다"
COIN_FLIP_RESET_CONFIRMATION = "동전 던지기 기록을 삭제합니다"
PADDLE_FLIGHT_RESET_CONFIRMATION = "탁구공 날리기 기록을 삭제합니다"


class PasswordResetRequest(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class PasswordResetResponse(BaseModel):
    message: str
    revoked_sessions: int


class DatabaseResetRequest(BaseModel):
    confirmation: str
    admin_password: str = Field(min_length=4, max_length=128)


class DatabaseResetCounts(BaseModel):
    matches: int
    competition_members: int
    competitions: int
    players: int
    player_sessions: int


class DatabaseResetPreview(DatabaseResetCounts):
    confirmation_required: str
    preserved_admins: int
    preserved_admin_sessions: int


class DatabaseResetResponse(BaseModel):
    message: str
    deleted: DatabaseResetCounts


class MinigameResetGame(StrEnum):
    COIN_FLIP = "coin-flip"
    PADDLE_FLIGHT = "paddle-flight"


class MinigameResetRequest(BaseModel):
    confirmation: str
    admin_password: str = Field(min_length=4, max_length=128)


class MinigameResetPreview(BaseModel):
    game: MinigameResetGame
    record_count: int
    confirmation_required: str


class MinigameResetResponse(BaseModel):
    game: MinigameResetGame
    deleted_records: int
    message: str
