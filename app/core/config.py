from __future__ import annotations

import json
from functools import lru_cache
from typing import Any
from urllib.parse import urlsplit

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import make_url

DEFAULT_PRIZES = {
    "matches": "경기 수 부문 상품",
    "wins": "승리 수 부문 상품",
    "losses": "패배 수 부문 상품",
    "opponents": "상대 수 부문 상품",
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Scutta API"
    environment: str = "development"
    database_url: str = "sqlite:///./scutta.db"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])

    session_cookie_name: str = "scutta_session"
    session_cookie_secure: bool = False
    session_cookie_samesite: str = "lax"
    session_ttl_days: int = Field(default=400, gt=0)
    session_refresh_days: int = Field(default=7, gt=0)
    session_max_per_user: int = Field(default=5, ge=1, le=50)

    login_rate_limit_attempts: int = Field(default=5, ge=1, le=100)
    login_rate_limit_window_seconds: int = Field(default=300, ge=1, le=86_400)

    settlement_draws: list[str] = Field(default_factory=lambda: ["중간고사 이후", "종강총회"])
    settlement_prizes: dict[str, str] = Field(default_factory=lambda: DEFAULT_PRIZES.copy())

    @field_validator("cors_origins", "settlement_draws", mode="before")
    @classmethod
    def parse_list(cls, value: Any) -> Any:
        if not isinstance(value, str):
            return value
        value = value.strip()
        if value.startswith("["):
            return json.loads(value)
        return [item.strip() for item in value.split(",") if item.strip()]

    @field_validator("settlement_prizes", mode="before")
    @classmethod
    def parse_dict(cls, value: Any) -> Any:
        if isinstance(value, str):
            return json.loads(value)
        return value

    @field_validator("session_cookie_samesite")
    @classmethod
    def validate_samesite(cls, value: str) -> str:
        normalized = value.lower()
        if normalized not in {"lax", "strict", "none"}:
            raise ValueError("SESSION_COOKIE_SAMESITE must be lax, strict, or none")
        return normalized

    @field_validator("cors_origins")
    @classmethod
    def normalize_cors_origins(cls, value: list[str]) -> list[str]:
        return [origin.strip() for origin in value]

    @model_validator(mode="after")
    def validate_security_settings(self) -> Settings:
        if self.session_refresh_days >= self.session_ttl_days:
            raise ValueError("SESSION_REFRESH_DAYS must be less than SESSION_TTL_DAYS")

        if self.session_cookie_samesite == "none" and not self.session_cookie_secure:
            raise ValueError("SameSite=None requires SESSION_COOKIE_SECURE=true")

        if self.environment.strip().lower() != "production":
            return self

        if not self.cors_origins:
            raise ValueError("CORS_ORIGINS must not be empty in production")
        if not self.session_cookie_secure:
            raise ValueError("SESSION_COOKIE_SECURE must be true in production")

        for origin in self.cors_origins:
            if not origin or origin.casefold() in {"*", "null"}:
                raise ValueError("CORS_ORIGINS must contain explicit HTTPS origins")

            parsed = urlsplit(origin)
            try:
                _ = parsed.port
            except ValueError as error:
                raise ValueError(f"invalid CORS origin: {origin}") from error

            if (
                parsed.scheme != "https"
                or parsed.hostname is None
                or parsed.username is not None
                or parsed.password is not None
                or parsed.path
                or parsed.query
                or parsed.fragment
            ):
                raise ValueError(f"production CORS origin must be HTTPS origin only: {origin}")

        return self

    @property
    def sqlalchemy_database_url(self) -> str:
        url = make_url(self.database_url)
        if url.drivername in {"postgres", "postgresql"}:
            url = url.set(drivername="postgresql+psycopg")
        return url.render_as_string(hide_password=False)


@lru_cache
def get_settings() -> Settings:
    return Settings()
