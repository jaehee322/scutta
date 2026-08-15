from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models import Gender, UserRole


def _strip_username(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("사용자 이름을 입력해 주세요.")
    return value


class PlayerCreate(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=8, max_length=128)
    gender: Gender
    is_freshman: bool = False
    club_rank: int = Field(gt=0)

    _normalize_username = field_validator("username")(_strip_username)


class PlayerUpdate(BaseModel):
    username: str | None = Field(default=None, min_length=1, max_length=64)
    gender: Gender | None = None
    is_freshman: bool | None = None
    club_rank: int | None = Field(default=None, gt=0)

    @field_validator("username")
    @classmethod
    def normalize_username(cls, value: str | None) -> str | None:
        return None if value is None else _strip_username(value)

    @model_validator(mode="after")
    def validate_patch(self) -> PlayerUpdate:
        if not self.model_fields_set:
            raise ValueError("수정할 항목을 하나 이상 입력해 주세요.")

        required_when_present = {
            "username",
            "gender",
            "is_freshman",
            "club_rank",
        }
        for field_name in required_when_present & self.model_fields_set:
            if getattr(self, field_name) is None:
                raise ValueError(f"{field_name}에는 null을 사용할 수 없습니다.")
        return self


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    role: UserRole
    gender: Gender | None
    is_freshman: bool
    club_rank: int | None
    created_at: datetime
    updated_at: datetime
