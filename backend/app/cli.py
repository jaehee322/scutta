from __future__ import annotations

import argparse
import getpass
import sys
from collections.abc import Sequence

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models import User, UserRole

BOOTSTRAP_ADMIN_USERNAME = "admin"
BOOTSTRAP_ADMIN_PASSWORD = "1234"


def ensure_bootstrap_admin(db: Session) -> tuple[User, bool]:
    """Create the initial Render admin once without changing an existing admin."""
    existing_admin = db.scalar(
        select(User).where(User.role == UserRole.ADMIN).order_by(User.id.asc()).limit(1)
    )
    if existing_admin is not None:
        return existing_admin, False

    admin = User(
        username=BOOTSTRAP_ADMIN_USERNAME,
        password_hash=hash_password(BOOTSTRAP_ADMIN_PASSWORD),
        role=UserRole.ADMIN,
        gender=None,
        is_freshman=False,
        club_rank=None,
        is_active=True,
        auth_version=1,
    )
    db.add(admin)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        existing_admin = db.scalar(
            select(User).where(User.role == UserRole.ADMIN).order_by(User.id.asc()).limit(1)
        )
        if existing_admin is not None:
            return existing_admin, False
        raise ValueError("admin 사용자 이름을 이미 다른 계정이 사용 중입니다.") from exc

    db.refresh(admin)
    return admin, True


def create_admin(db: Session, *, username: str, password: str) -> User:
    username = username.strip()
    if not username:
        raise ValueError("사용자 이름을 입력해 주세요.")
    if len(username) > 64:
        raise ValueError("사용자 이름은 64자 이하여야 합니다.")
    if not 8 <= len(password) <= 128:
        raise ValueError("비밀번호는 8자 이상 128자 이하여야 합니다.")
    if db.scalar(select(User.id).where(User.username == username)) is not None:
        raise ValueError("이미 사용 중인 사용자 이름입니다.")

    admin = User(
        username=username,
        password_hash=hash_password(password),
        role=UserRole.ADMIN,
        gender=None,
        is_freshman=False,
        club_rank=None,
        is_active=True,
        auth_version=1,
    )
    db.add(admin)
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise ValueError("이미 사용 중인 사용자 이름입니다.") from exc
    db.refresh(admin)
    return admin


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Scutta 관리 명령")
    subparsers = parser.add_subparsers(dest="command", required=True)

    create_parser = subparsers.add_parser(
        "create-admin", description="최초 관리자 계정을 생성합니다."
    )
    create_parser.add_argument("--username", required=True, help="관리자 사용자 이름")
    create_parser.add_argument(
        "--password",
        help="비밀번호(생략하면 노출되지 않는 프롬프트에서 입력)",
    )
    subparsers.add_parser(
        "ensure-admin",
        description="관리자가 없을 때만 최초 admin 계정을 생성합니다.",
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = _build_parser().parse_args(argv)

    if args.command == "ensure-admin":
        try:
            with SessionLocal() as db:
                admin, created = ensure_bootstrap_admin(db)
        except (ValueError, OSError) as exc:
            print(f"오류: {exc}", file=sys.stderr)
            return 1

        if created:
            print(f"최초 관리자를 생성했습니다: {admin.username} (id={admin.id})")
        else:
            print(f"기존 관리자를 유지합니다: {admin.username} (id={admin.id})")
        return 0

    password = args.password
    if password is None:
        password = getpass.getpass("비밀번호: ")
        password_confirmation = getpass.getpass("비밀번호 확인: ")
        if password != password_confirmation:
            print("오류: 비밀번호 확인이 일치하지 않습니다.", file=sys.stderr)
            return 1

    try:
        with SessionLocal() as db:
            admin = create_admin(db, username=args.username, password=password)
    except (ValueError, OSError) as exc:
        print(f"오류: {exc}", file=sys.stderr)
        return 1

    print(f"관리자를 생성했습니다: {admin.username} (id={admin.id})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
