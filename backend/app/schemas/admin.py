from __future__ import annotations

from pydantic import BaseModel, Field

DATABASE_RESET_CONFIRMATION = "모든 경기와 선수 데이터를 삭제합니다"


class PasswordResetRequest(BaseModel):
    new_password: str = Field(min_length=8, max_length=128)


class PasswordResetResponse(BaseModel):
    message: str
    revoked_sessions: int


class DatabaseResetRequest(BaseModel):
    confirmation: str
    admin_password: str = Field(min_length=8, max_length=128)


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
