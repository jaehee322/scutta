from __future__ import annotations

from collections.abc import Callable, Generator
from contextlib import ExitStack
from dataclasses import dataclass

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import get_settings
from app.core.database import Base, get_db
from app.core.security import hash_password
from app.main import app
from app.models import User, UserRole


@dataclass(slots=True)
class ApiHarness:
    session_factory: sessionmaker[Session]
    client: Callable[[], TestClient]

    def create_admin(self, username: str = "admin", password: str = "admin-password") -> User:
        with self.session_factory() as db:
            admin = User(
                username=username,
                password_hash=hash_password(password),
                role=UserRole.ADMIN,
                gender=None,
                is_freshman=False,
                club_rank=None,
                is_active=True,
            )
            db.add(admin)
            db.commit()
            db.refresh(admin)
            db.expunge(admin)
            return admin

    @staticmethod
    def login(client: TestClient, username: str, password: str) -> None:
        response = client.post(
            "/api/v1/auth/login",
            json={"username": username, "password": password},
        )
        assert response.status_code == 200, response.text


@pytest.fixture
def api() -> Generator[ApiHarness, None, None]:
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection: object, _: object) -> None:
        cursor = dbapi_connection.cursor()  # type: ignore[attr-defined]
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db() -> Generator[Session, None, None]:
        with factory() as db:
            yield db

    settings = get_settings()
    original_secure = settings.session_cookie_secure
    settings.session_cookie_secure = False
    app.dependency_overrides[get_db] = override_get_db

    with ExitStack() as stack:
        harness = ApiHarness(
            session_factory=factory,
            client=lambda: stack.enter_context(TestClient(app)),
        )
        yield harness

    app.dependency_overrides.clear()
    settings.session_cookie_secure = original_secure
    Base.metadata.drop_all(engine)
    engine.dispose()
