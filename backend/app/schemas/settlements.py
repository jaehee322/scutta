from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


def _normalize_text(value: str) -> str:
    value = value.strip()
    if not value:
        raise ValueError("빈 문자열을 사용할 수 없습니다.")
    return value


class SettlementPrizes(BaseModel):
    matches: str
    wins: str
    losses: str
    opponents: str


class SettlementPrizesUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    matches: str | None = Field(default=None, min_length=1, max_length=200)
    wins: str | None = Field(default=None, min_length=1, max_length=200)
    losses: str | None = Field(default=None, min_length=1, max_length=200)
    opponents: str | None = Field(default=None, min_length=1, max_length=200)

    @field_validator("matches", "wins", "losses", "opponents")
    @classmethod
    def normalize_prize(cls, value: str | None) -> str | None:
        return None if value is None else _normalize_text(value)

    @model_validator(mode="after")
    def validate_patch(self) -> SettlementPrizesUpdate:
        if not self.model_fields_set:
            raise ValueError("수정할 상품을 하나 이상 입력해 주세요.")
        for field_name in self.model_fields_set:
            if getattr(self, field_name) is None:
                raise ValueError(f"{field_name}에는 null을 사용할 수 없습니다.")
        return self


class SettlementSettingsRead(BaseModel):
    prizes: SettlementPrizes


class SettlementSettingsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    prizes: SettlementPrizesUpdate | None = None

    @model_validator(mode="after")
    def validate_patch(self) -> SettlementSettingsUpdate:
        if not self.model_fields_set:
            raise ValueError("수정할 항목을 하나 이상 입력해 주세요.")
        if self.prizes is None:
            raise ValueError("prizes에는 null을 사용할 수 없습니다.")
        return self
