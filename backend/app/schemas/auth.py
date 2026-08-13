from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.schemas.users import UserRead


class LoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("사용자 이름을 입력해 주세요.")
        return value


class LoginResponse(BaseModel):
    user: UserRead


class PasswordChangeRequest(BaseModel):
    current_password: str = Field(min_length=8, max_length=128)
    new_password: str = Field(min_length=8, max_length=128)


class MessageResponse(BaseModel):
    message: str
