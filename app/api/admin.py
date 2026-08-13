from __future__ import annotations

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import delete, func, select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import CurrentAdmin, DbSession
from app.core.security import hash_password, verify_password
from app.models import (
    AuthSession,
    Competition,
    CompetitionMember,
    Match,
    User,
    UserRole,
)
from app.schemas.admin import (
    DATABASE_RESET_CONFIRMATION,
    DatabaseResetCounts,
    DatabaseResetPreview,
    DatabaseResetRequest,
    DatabaseResetResponse,
    PasswordResetRequest,
    PasswordResetResponse,
)
from app.schemas.users import PlayerCreate, PlayerUpdate, UserRead

router = APIRouter(prefix="/admin", tags=["admin"])


def _player_or_404(db: Session, user_id: int, *, for_update: bool = False) -> User:
    statement = select(User).where(User.id == user_id, User.role == UserRole.PLAYER)
    if for_update:
        statement = statement.with_for_update()
    player = db.scalar(statement)
    if player is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="선수를 찾을 수 없습니다.",
        )
    return player


def _username_conflict(db: Session, username: str, *, excluding_id: int | None = None) -> bool:
    statement = select(User.id).where(User.username == username)
    if excluding_id is not None:
        statement = statement.where(User.id != excluding_id)
    return db.scalar(statement) is not None


def _conflict() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail="이미 사용 중인 사용자 이름입니다.",
    )


def _is_username_integrity_error(error: IntegrityError) -> bool:
    constraint_name = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
    return constraint_name == "uq_users_username" or (
        "unique constraint failed" in str(error.orig).casefold()
        and "users.username" in str(error.orig).casefold()
    )


@router.post("/players", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_player(payload: PlayerCreate, db: DbSession, _: CurrentAdmin) -> User:
    if _username_conflict(db, payload.username):
        raise _conflict()

    player = User(
        username=payload.username,
        password_hash=hash_password(payload.password),
        role=UserRole.PLAYER,
        gender=payload.gender,
        is_freshman=payload.is_freshman,
        club_rank=payload.club_rank,
        is_active=payload.is_active,
        auth_version=1,
    )
    db.add(player)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if _is_username_integrity_error(exc):
            raise _conflict() from exc
        raise
    db.refresh(player)
    return player


@router.get("/players", response_model=list[UserRead])
def list_players(db: DbSession, _: CurrentAdmin) -> list[User]:
    return list(
        db.scalars(
            select(User).where(User.role == UserRole.PLAYER).order_by(User.username, User.id)
        )
    )


@router.patch("/players/{user_id}", response_model=UserRead)
def update_player(
    user_id: int,
    payload: PlayerUpdate,
    db: DbSession,
    _: CurrentAdmin,
) -> User:
    player = _player_or_404(db, user_id, for_update=True)
    fields = payload.model_fields_set

    if "username" in fields:
        assert payload.username is not None
        if _username_conflict(db, payload.username, excluding_id=player.id):
            raise _conflict()
        player.username = payload.username
    if "gender" in fields:
        player.gender = payload.gender
    if "is_freshman" in fields:
        assert payload.is_freshman is not None
        player.is_freshman = payload.is_freshman
    if "club_rank" in fields:
        player.club_rank = payload.club_rank
    if "is_active" in fields:
        assert payload.is_active is not None
        player.is_active = payload.is_active
        if not payload.is_active:
            player.auth_version += 1
            db.execute(delete(AuthSession).where(AuthSession.user_id == player.id))

    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        if _is_username_integrity_error(exc):
            raise _conflict() from exc
        raise
    db.refresh(player)
    return player


@router.post(
    "/players/{user_id}/password-reset",
    response_model=PasswordResetResponse,
)
def reset_player_password(
    user_id: int,
    payload: PasswordResetRequest,
    db: DbSession,
    _: CurrentAdmin,
) -> PasswordResetResponse:
    player = _player_or_404(db, user_id, for_update=True)
    player.password_hash = hash_password(payload.new_password)
    player.auth_version += 1
    result = db.execute(delete(AuthSession).where(AuthSession.user_id == player.id))
    db.commit()
    return PasswordResetResponse(
        message="비밀번호를 초기화했습니다.",
        revoked_sessions=result.rowcount or 0,
    )


def _count(db: Session, model: type[object], *conditions: object) -> int:
    statement = select(func.count()).select_from(model)
    if conditions:
        statement = statement.where(*conditions)
    return int(db.scalar(statement) or 0)


def get_database_reset_preview(db: Session) -> DatabaseResetPreview:
    player_ids = select(User.id).where(User.role == UserRole.PLAYER)
    return DatabaseResetPreview(
        confirmation_required=DATABASE_RESET_CONFIRMATION,
        matches=_count(db, Match),
        competition_members=_count(db, CompetitionMember),
        competitions=_count(db, Competition),
        players=_count(db, User, User.role == UserRole.PLAYER),
        player_sessions=_count(db, AuthSession, AuthSession.user_id.in_(player_ids)),
        preserved_admins=_count(db, User, User.role == UserRole.ADMIN),
        preserved_admin_sessions=_count(
            db,
            AuthSession,
            AuthSession.user_id.in_(select(User.id).where(User.role == UserRole.ADMIN)),
        ),
    )


@router.get("/database/reset-preview", response_model=DatabaseResetPreview)
def preview_database_reset(db: DbSession, _: CurrentAdmin) -> DatabaseResetPreview:
    return get_database_reset_preview(db)


@router.post("/database/reset", response_model=DatabaseResetResponse)
def reset_database(
    payload: DatabaseResetRequest,
    db: DbSession,
    admin: CurrentAdmin,
) -> DatabaseResetResponse:
    if payload.confirmation != DATABASE_RESET_CONFIRMATION:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="확인 문구가 일치하지 않습니다.",
        )
    locked_admin = db.scalar(
        select(User)
        .where(User.id == admin.id, User.role == UserRole.ADMIN)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if locked_admin is None or not verify_password(
        payload.admin_password, locked_admin.password_hash
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관리자 비밀번호가 올바르지 않습니다.",
        )

    if db.get_bind().dialect.name == "postgresql":
        # Make the reset one serializable maintenance operation. Ordinary writes
        # either finish before this point or wait until the reset commits.
        db.execute(
            text(
                "LOCK TABLE users, competitions, auth_sessions, "
                "competition_members, matches IN ACCESS EXCLUSIVE MODE"
            )
        )

    preview = get_database_reset_preview(db)
    deleted = DatabaseResetCounts(
        matches=preview.matches,
        competition_members=preview.competition_members,
        competitions=preview.competitions,
        players=preview.players,
        player_sessions=preview.player_sessions,
    )

    player_ids = select(User.id).where(User.role == UserRole.PLAYER)
    db.execute(delete(Match))
    db.execute(delete(CompetitionMember))
    db.execute(delete(Competition))
    db.execute(delete(AuthSession).where(AuthSession.user_id.in_(player_ids)))
    db.execute(delete(User).where(User.role == UserRole.PLAYER))
    db.commit()

    return DatabaseResetResponse(
        message="경기, 대회, 선수 데이터를 초기화했습니다.",
        deleted=deleted,
    )
