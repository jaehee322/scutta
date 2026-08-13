from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.core.database import get_db
from app.core.security import hash_session_token, new_session_token, utc_now
from app.models import AuthSession, User, UserRole

DbSession = Annotated[Session, Depends(get_db)]


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def set_session_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    max_age = settings.session_ttl_days * 24 * 60 * 60
    response.set_cookie(
        key=settings.session_cookie_name,
        value=token,
        max_age=max_age,
        path="/",
        secure=settings.session_cookie_secure,
        httponly=True,
        samesite=settings.session_cookie_samesite,  # type: ignore[arg-type]
    )


def clear_session_cookie(response: Response) -> None:
    settings = get_settings()
    response.delete_cookie(
        key=settings.session_cookie_name,
        path="/",
        secure=settings.session_cookie_secure,
        httponly=True,
        samesite=settings.session_cookie_samesite,  # type: ignore[arg-type]
    )


def create_auth_session(db: Session, user: User) -> tuple[AuthSession, str]:
    settings = get_settings()
    now = utc_now()
    token, token_hash = new_session_token()
    if not user.is_active:
        raise _unauthorized()

    db.execute(
        delete(AuthSession).where(
            AuthSession.user_id == user.id,
            AuthSession.expires_at <= now,
        )
    )
    excess_ids = list(
        db.scalars(
            select(AuthSession.id)
            .where(AuthSession.user_id == user.id)
            .order_by(AuthSession.last_seen_at.desc(), AuthSession.created_at.desc())
            .offset(settings.session_max_per_user - 1)
        )
    )
    if excess_ids:
        db.execute(delete(AuthSession).where(AuthSession.id.in_(excess_ids)))

    auth_session = AuthSession(
        user_id=user.id,
        token_hash=token_hash,
        auth_version=user.auth_version,
        created_at=now,
        last_seen_at=now,
        expires_at=now + timedelta(days=settings.session_ttl_days),
    )
    db.add(auth_session)
    return auth_session, token


def _unauthorized(*, clear_cookie: bool = False) -> HTTPException:
    headers = {"WWW-Authenticate": "Session"}
    if clear_cookie:
        cookie_response = Response()
        clear_session_cookie(cookie_response)
        headers["Set-Cookie"] = cookie_response.headers["set-cookie"]
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="로그인이 필요합니다.",
        headers=headers,
    )


def get_current_session(
    request: Request,
    response: Response,
    db: DbSession,
) -> AuthSession:
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    if not token:
        raise _unauthorized()

    auth_session = db.scalar(
        select(AuthSession)
        .options(joinedload(AuthSession.user))
        .where(AuthSession.token_hash == hash_session_token(token))
    )
    if auth_session is None:
        raise _unauthorized(clear_cookie=True)

    now = utc_now()
    if (
        _as_utc(auth_session.expires_at) <= now
        or not auth_session.user.is_active
        or auth_session.auth_version != auth_session.user.auth_version
    ):
        db.delete(auth_session)
        db.commit()
        raise _unauthorized(clear_cookie=True)

    refresh_before = now - timedelta(days=settings.session_refresh_days)
    if _as_utc(auth_session.last_seen_at) <= refresh_before:
        auth_session.last_seen_at = now
        auth_session.expires_at = now + timedelta(days=settings.session_ttl_days)
        db.commit()
        set_session_cookie(response, token)

    return auth_session


def get_current_user(
    auth_session: Annotated[AuthSession, Depends(get_current_session)],
) -> User:
    return auth_session.user


def get_current_player(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    if user.role != UserRole.PLAYER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="선수 계정만 사용할 수 있습니다.",
        )
    return user


def get_current_admin(
    user: Annotated[User, Depends(get_current_user)],
) -> User:
    if user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="관리자 권한이 필요합니다.",
        )
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
CurrentPlayer = Annotated[User, Depends(get_current_player)]
CurrentAdmin = Annotated[User, Depends(get_current_admin)]
