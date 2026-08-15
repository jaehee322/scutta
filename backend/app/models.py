from __future__ import annotations

import enum
from datetime import date, datetime

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class UserRole(enum.StrEnum):
    PLAYER = "player"
    ADMIN = "admin"


class Gender(enum.StrEnum):
    MALE = "M"
    FEMALE = "F"


class MatchKind(enum.StrEnum):
    CASUAL = "casual"
    DAILY = "daily"
    COMPETITION = "competition"


class CompetitionType(enum.StrEnum):
    LEAGUE = "league"
    TOURNAMENT = "tournament"


class CompetitionStatus(enum.StrEnum):
    ACTIVE = "active"
    COMPLETED = "completed"


def string_enum(enum_class: type[enum.Enum], name: str) -> Enum:
    return Enum(
        enum_class,
        name=name,
        native_enum=False,
        create_constraint=False,
        validate_strings=True,
        values_callable=lambda members: [member.value for member in members],
    )


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("club_rank IS NULL OR club_rank > 0", name="club_rank_positive"),
        CheckConstraint("auth_version > 0", name="auth_version_positive"),
        CheckConstraint("role IN ('player', 'admin')", name="user_role"),
        CheckConstraint("gender IN ('M', 'F')", name="gender"),
        CheckConstraint(
            "role = 'admin' OR (gender IS NOT NULL AND club_rank IS NOT NULL)",
            name="player_profile_required",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(
        string_enum(UserRole, "user_role"), default=UserRole.PLAYER, nullable=False
    )
    gender: Mapped[Gender | None] = mapped_column(string_enum(Gender, "gender"), nullable=True)
    is_freshman: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    club_rank: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    auth_version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)

    sessions: Mapped[list[AuthSession]] = relationship(
        back_populates="user", cascade="all, delete-orphan", passive_deletes=True
    )


class AuthSession(Base):
    __tablename__ = "auth_sessions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True, nullable=False
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    auth_version: Mapped[int] = mapped_column(Integer, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), index=True, nullable=False
    )

    user: Mapped[User] = relationship(back_populates="sessions")


class Competition(TimestampMixin, Base):
    __tablename__ = "competitions"
    __table_args__ = (
        CheckConstraint("type IN ('league', 'tournament')", name="competition_type"),
        CheckConstraint("status IN ('active', 'completed')", name="competition_status"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[CompetitionType] = mapped_column(
        string_enum(CompetitionType, "competition_type"), nullable=False
    )
    status: Mapped[CompetitionStatus] = mapped_column(
        string_enum(CompetitionStatus, "competition_status"),
        default=CompetitionStatus.ACTIVE,
        nullable=False,
    )

    members: Mapped[list[CompetitionMember]] = relationship(
        back_populates="competition", cascade="all, delete-orphan", passive_deletes=True
    )


class CompetitionMember(Base):
    __tablename__ = "competition_members"
    __table_args__ = (
        CheckConstraint("position IS NULL OR position > 0", name="position_positive"),
    )

    competition_id: Mapped[int] = mapped_column(
        ForeignKey("competitions.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    position: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)

    competition: Mapped[Competition] = relationship(back_populates="members")


class Match(TimestampMixin, Base):
    __tablename__ = "matches"
    __table_args__ = (
        CheckConstraint("player1_id < player2_id", name="canonical_player_order"),
        CheckConstraint("kind IN ('casual', 'daily', 'competition')", name="match_kind"),
        CheckConstraint(
            "(score1 = 3 AND score2 = 0) OR "
            "(score1 = 0 AND score2 = 3) OR "
            "(score1 = 2 AND score2 = 1) OR "
            "(score1 = 1 AND score2 = 2)",
            name="allowed_score",
        ),
        UniqueConstraint("played_on", "player1_id", "player2_id", name="daily_player_pair"),
        Index("ix_matches_player1_played_on", "player1_id", "played_on"),
        Index("ix_matches_player2_played_on", "player2_id", "played_on"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    competition_id: Mapped[int | None] = mapped_column(
        ForeignKey("competitions.id", ondelete="SET NULL"), nullable=True
    )
    player1_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    player2_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    score1: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    score2: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    kind: Mapped[MatchKind] = mapped_column(
        string_enum(MatchKind, "match_kind"), default=MatchKind.CASUAL, nullable=False
    )
    played_on: Mapped[date] = mapped_column(Date, nullable=False)
    submitted_by_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    updated_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
