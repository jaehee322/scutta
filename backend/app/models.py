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
    ForeignKeyConstraint,
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
    TEAM = "team"


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
        CheckConstraint(
            "club_rank IS NULL OR club_rank BETWEEN -2 AND 7",
            name="club_rank_range",
        ),
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
    coin_flip_state: Mapped[CoinFlipState | None] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
        passive_deletes=True,
        uselist=False,
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


class SettlementSettings(TimestampMixin, Base):
    __tablename__ = "settlement_settings"
    __table_args__ = (CheckConstraint("id = 1", name="singleton"),)

    id: Mapped[int] = mapped_column(SmallInteger, primary_key=True, default=1)
    matches_prize: Mapped[str | None] = mapped_column(String(200), nullable=True)
    wins_prize: Mapped[str | None] = mapped_column(String(200), nullable=True)
    losses_prize: Mapped[str | None] = mapped_column(String(200), nullable=True)
    opponents_prize: Mapped[str | None] = mapped_column(String(200), nullable=True)


class CoinFlipState(Base):
    __tablename__ = "coin_flip_states"
    __table_args__ = (
        CheckConstraint("current_streak >= 0", name="current_streak_nonnegative"),
        CheckConstraint("best_streak >= 0", name="best_streak_nonnegative"),
        CheckConstraint("run_id > 0", name="run_id_positive"),
        CheckConstraint("current_streak <= best_streak", name="current_not_above_best"),
        CheckConstraint("active OR current_streak = 0", name="inactive_streak_zero"),
        CheckConstraint(
            "daily_attempts_used >= 0 AND daily_attempts_used <= 20",
            name="daily_attempts_range",
        ),
        CheckConstraint(
            "(daily_attempt_date IS NULL AND daily_attempts_used = 0) OR "
            "(daily_attempt_date IS NOT NULL AND daily_attempts_used > 0)",
            name="daily_attempts_date_consistency",
        ),
        CheckConstraint(
            "(best_streak = 0 AND best_achieved_at IS NULL) OR "
            "(best_streak > 0 AND best_achieved_at IS NOT NULL)",
            name="best_achievement_time",
        ),
    )

    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    active: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    run_id: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    current_streak: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    best_streak: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    best_achieved_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    last_flip_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    daily_attempt_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    daily_attempts_used: Mapped[int] = mapped_column(SmallInteger, default=0, nullable=False)

    user: Mapped[User] = relationship(back_populates="coin_flip_state")


class Competition(TimestampMixin, Base):
    __tablename__ = "competitions"
    __table_args__ = (
        CheckConstraint("type IN ('league', 'team')", name="competition_type"),
        CheckConstraint("status IN ('active', 'completed')", name="competition_status"),
        CheckConstraint(
            "(status = 'active' AND completed_at IS NULL) OR "
            "(status = 'completed' AND completed_at IS NOT NULL)",
            name="completion_state",
        ),
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
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    members: Mapped[list[CompetitionMember]] = relationship(
        back_populates="competition", cascade="all, delete-orphan", passive_deletes=True
    )
    league_fixtures: Mapped[list[LeagueFixture]] = relationship(
        back_populates="competition", cascade="all, delete-orphan", passive_deletes=True
    )
    teams: Mapped[list[CompetitionTeam]] = relationship(
        back_populates="competition", cascade="all, delete-orphan", passive_deletes=True
    )
    team_encounters: Mapped[list[TeamEncounter]] = relationship(
        back_populates="competition", cascade="all, delete-orphan", passive_deletes=True
    )


class CompetitionMember(Base):
    __tablename__ = "competition_members"

    competition_id: Mapped[int] = mapped_column(
        ForeignKey("competitions.id", ondelete="CASCADE"), primary_key=True
    )
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    competition: Mapped[Competition] = relationship(back_populates="members")


class LeagueFixture(Base):
    __tablename__ = "league_fixtures"
    __table_args__ = (
        CheckConstraint("player1_id < player2_id", name="canonical_player_order"),
        CheckConstraint("round_no > 0", name="round_positive"),
        CheckConstraint("order_no > 0", name="order_positive"),
        UniqueConstraint(
            "competition_id",
            "player1_id",
            "player2_id",
            name="league_fixture_player_pair",
        ),
        UniqueConstraint(
            "competition_id",
            "round_no",
            "order_no",
            name="league_fixture_round_order",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    competition_id: Mapped[int] = mapped_column(
        ForeignKey("competitions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    player1_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    player2_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    round_no: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    order_no: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    match_id: Mapped[int | None] = mapped_column(
        ForeignKey("matches.id", ondelete="SET NULL"), unique=True, nullable=True
    )

    competition: Mapped[Competition] = relationship(back_populates="league_fixtures")


class CompetitionTeam(Base):
    __tablename__ = "competition_teams"
    __table_args__ = (
        UniqueConstraint("competition_id", "name", name="competition_team_name"),
        UniqueConstraint("id", "competition_id", name="competition_team_identity"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    competition_id: Mapped[int] = mapped_column(
        ForeignKey("competitions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    name: Mapped[str] = mapped_column(String(64), nullable=False)

    competition: Mapped[Competition] = relationship(back_populates="teams")
    members: Mapped[list[CompetitionTeamMember]] = relationship(
        back_populates="team", cascade="all, delete-orphan", passive_deletes=True
    )


class CompetitionTeamMember(Base):
    __tablename__ = "competition_team_members"
    __table_args__ = (
        ForeignKeyConstraint(
            ["team_id", "competition_id"],
            ["competition_teams.id", "competition_teams.competition_id"],
            ondelete="CASCADE",
            name="team_member_team_identity",
        ),
    )

    competition_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), primary_key=True
    )
    team_id: Mapped[int] = mapped_column(Integer, index=True, nullable=False)

    team: Mapped[CompetitionTeam] = relationship(back_populates="members")


class TeamEncounter(Base):
    __tablename__ = "team_encounters"
    __table_args__ = (
        CheckConstraint("team1_id < team2_id", name="canonical_team_order"),
        CheckConstraint("round_no > 0", name="round_positive"),
        CheckConstraint("order_no > 0", name="order_positive"),
        UniqueConstraint(
            "competition_id",
            "team1_id",
            "team2_id",
            name="team_encounter_pair",
        ),
        UniqueConstraint(
            "competition_id",
            "round_no",
            "order_no",
            name="team_encounter_round_order",
        ),
        ForeignKeyConstraint(
            ["team1_id", "competition_id"],
            ["competition_teams.id", "competition_teams.competition_id"],
            ondelete="CASCADE",
            name="team_encounter_team1_identity",
        ),
        ForeignKeyConstraint(
            ["team2_id", "competition_id"],
            ["competition_teams.id", "competition_teams.competition_id"],
            ondelete="CASCADE",
            name="team_encounter_team2_identity",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    competition_id: Mapped[int] = mapped_column(
        ForeignKey("competitions.id", ondelete="CASCADE"), index=True, nullable=False
    )
    team1_id: Mapped[int] = mapped_column(Integer, nullable=False)
    team2_id: Mapped[int] = mapped_column(Integer, nullable=False)
    round_no: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    order_no: Mapped[int] = mapped_column(SmallInteger, nullable=False)

    competition: Mapped[Competition] = relationship(back_populates="team_encounters")
    singles: Mapped[list[TeamSingleGame]] = relationship(
        back_populates="encounter", cascade="all, delete-orphan", passive_deletes=True
    )
    doubles: Mapped[TeamDoublesGame | None] = relationship(
        back_populates="encounter",
        cascade="all, delete-orphan",
        passive_deletes=True,
        uselist=False,
    )


class TeamSingleGame(Base):
    __tablename__ = "team_single_games"
    __table_args__ = (
        CheckConstraint("sequence BETWEEN 1 AND 4", name="sequence_range"),
        UniqueConstraint("encounter_id", "sequence", name="team_single_sequence"),
        UniqueConstraint("encounter_id", "team1_player_id", name="team_single_team1_player"),
        UniqueConstraint("encounter_id", "team2_player_id", name="team_single_team2_player"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    encounter_id: Mapped[int] = mapped_column(
        ForeignKey("team_encounters.id", ondelete="CASCADE"), index=True, nullable=False
    )
    sequence: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    team1_player_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    team2_player_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    match_id: Mapped[int] = mapped_column(
        ForeignKey("matches.id", ondelete="CASCADE"), unique=True, nullable=False
    )

    encounter: Mapped[TeamEncounter] = relationship(back_populates="singles")


class TeamDoublesGame(TimestampMixin, Base):
    __tablename__ = "team_doubles_games"
    __table_args__ = (
        CheckConstraint("team1_player1_id < team1_player2_id", name="team1_player_order"),
        CheckConstraint("team2_player1_id < team2_player2_id", name="team2_player_order"),
        CheckConstraint(
            "(score1 IS NULL AND score2 IS NULL AND played_on IS NULL) OR "
            "((score1 = 3 AND score2 = 0) OR "
            "(score1 = 0 AND score2 = 3) OR "
            "(score1 = 2 AND score2 = 1) OR "
            "(score1 = 1 AND score2 = 2)) AND played_on IS NOT NULL",
            name="allowed_score",
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    encounter_id: Mapped[int] = mapped_column(
        ForeignKey("team_encounters.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    team1_player1_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    team1_player2_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    team2_player1_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    team2_player2_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    score1: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    score2: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    played_on: Mapped[date | None] = mapped_column(Date, nullable=True)
    played_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    updated_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )

    encounter: Mapped[TeamEncounter] = relationship(back_populates="doubles")


class Match(Base):
    __tablename__ = "matches"
    __table_args__ = (
        CheckConstraint("player1_id < player2_id", name="canonical_player_order"),
        CheckConstraint("kind IN ('casual', 'daily', 'competition')", name="match_kind"),
        CheckConstraint(
            "(kind = 'competition' AND competition_id IS NOT NULL) OR "
            "(kind IN ('casual', 'daily') AND competition_id IS NULL)",
            name="competition_link",
        ),
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
    # Migration 0006 preserves historical submission times by renaming created_at.
    # SQLite stores UTC values without tzinfo; the service layer interprets those
    # naive values as UTC before exposing them.
    played_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
