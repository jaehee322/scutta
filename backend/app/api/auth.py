from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field
from threading import Lock
from time import monotonic
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy import delete, select

from app.api.deps import (
    DbSession,
    clear_session_cookie,
    create_auth_session,
    get_current_session,
    get_current_user,
    set_session_cookie,
)
from app.core.config import get_settings
from app.core.security import hash_password, hash_session_token, verify_password
from app.models import AuthSession, User
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    MessageResponse,
    PasswordChangeRequest,
)
from app.schemas.users import UserRead

router = APIRouter(prefix="/auth", tags=["auth"])

DUMMY_PASSWORD_HASH = hash_password("not-a-real-password")


@dataclass(slots=True)
class LoginRateLimiter:
    attempts: dict[tuple[str, str], deque[float]] = field(default_factory=dict)
    ip_attempts: dict[str, deque[float]] = field(default_factory=dict)
    lock: Lock = field(default_factory=Lock)

    @staticmethod
    def _prune_bucket(bucket: deque[float], cutoff: float) -> None:
        while bucket and bucket[0] <= cutoff:
            bucket.popleft()

    def _prune_all(self, cutoff: float) -> None:
        for mapping in (self.attempts, self.ip_attempts):
            expired_keys = []
            for existing_key, bucket in mapping.items():
                self._prune_bucket(bucket, cutoff)
                if not bucket:
                    expired_keys.append(existing_key)
            for expired_key in expired_keys:
                mapping.pop(expired_key, None)

    def consume(self, key: tuple[str, str], *, limit: int, window_seconds: int) -> int | None:
        now = monotonic()
        cutoff = now - window_seconds
        with self.lock:
            self._prune_all(cutoff)
            recent = self.attempts.get(key)
            by_ip = self.ip_attempts.get(key[0])
            if recent is not None and len(recent) >= limit:
                return max(1, int(recent[0] + window_seconds - now) + 1)
            ip_limit = max(limit * 20, 100)
            if by_ip is not None and len(by_ip) >= ip_limit:
                return max(1, int(by_ip[0] + window_seconds - now) + 1)
            self.attempts.setdefault(key, deque()).append(now)
            self.ip_attempts.setdefault(key[0], deque()).append(now)
            return None

    def clear(self, key: tuple[str, str]) -> None:
        with self.lock:
            self.attempts.pop(key, None)

    def reset(self) -> None:
        """Clear process-local state; intended for tests and worker lifecycle hooks."""
        with self.lock:
            self.attempts.clear()
            self.ip_attempts.clear()


login_rate_limiter = LoginRateLimiter()


def _login_key(request: Request, username: str) -> tuple[str, str]:
    client_ip = request.client.host if request.client is not None else "unknown"
    return client_ip, username.casefold()


def _invalid_login(*, retry_after: int | None = None) -> HTTPException:
    if retry_after is not None:
        return HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="로그인 시도가 너무 많습니다. 잠시 후 다시 시도해 주세요.",
            headers={"Retry-After": str(retry_after)},
        )
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="사용자 이름 또는 비밀번호가 올바르지 않습니다.",
    )


@router.post("/login", response_model=LoginResponse)
def login(
    payload: LoginRequest,
    request: Request,
    response: Response,
    db: DbSession,
) -> LoginResponse:
    settings = get_settings()
    key = _login_key(request, payload.username)
    retry_after = login_rate_limiter.consume(
        key,
        limit=settings.login_rate_limit_attempts,
        window_seconds=settings.login_rate_limit_window_seconds,
    )
    if retry_after is not None:
        raise _invalid_login(retry_after=retry_after)

    user = db.scalar(select(User).where(User.username == payload.username).with_for_update())
    password_hash = user.password_hash if user is not None else DUMMY_PASSWORD_HASH
    password_matches = verify_password(payload.password, password_hash)
    if user is None or not password_matches:
        raise _invalid_login()

    _, token = create_auth_session(db, user)
    db.commit()
    login_rate_limiter.clear(key)
    set_session_cookie(response, token)
    return LoginResponse(user=UserRead.model_validate(user))


@router.get("/me", response_model=UserRead)
def me(user: Annotated[User, Depends(get_current_user)]) -> User:
    return user


@router.post("/logout", response_model=MessageResponse)
def logout(request: Request, response: Response, db: DbSession) -> MessageResponse:
    settings = get_settings()
    token = request.cookies.get(settings.session_cookie_name)
    if token:
        db.execute(delete(AuthSession).where(AuthSession.token_hash == hash_session_token(token)))
        db.commit()
    clear_session_cookie(response)
    return MessageResponse(message="로그아웃했습니다.")


@router.patch("/password", response_model=MessageResponse)
def change_password(
    payload: PasswordChangeRequest,
    response: Response,
    db: DbSession,
    auth_session: Annotated[AuthSession, Depends(get_current_session)],
) -> MessageResponse:
    user = db.scalar(
        select(User)
        .where(User.id == auth_session.user_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if (
        user is None
        or auth_session.auth_version != user.auth_version
        or not verify_password(payload.current_password, user.password_hash)
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="현재 비밀번호가 올바르지 않습니다.",
        )

    user.password_hash = hash_password(payload.new_password)
    user.auth_version += 1
    db.execute(delete(AuthSession).where(AuthSession.user_id == user.id))
    _, token = create_auth_session(db, user)
    db.commit()
    set_session_cookie(response, token)
    return MessageResponse(message="비밀번호를 변경했습니다.")
