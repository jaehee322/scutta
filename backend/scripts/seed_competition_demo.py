"""Preview or atomically replace local competitions with 20-player demo scenarios.

Run from any directory with the backend virtualenv. The default dry run rolls
back every database change. Only --apply persists the replacement and first
creates a SQLite backup. This script never creates or changes user accounts.
"""

# ruff: noqa: E402
from __future__ import annotations

import argparse
import hashlib
import json
import os
import sqlite3
import sys
from contextlib import closing
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

BACKEND = Path(__file__).resolve().parents[1]
ROOT = BACKEND.parent
os.chdir(BACKEND)
sys.path.insert(0, str(BACKEND))

from sqlalchemy import select
from sqlalchemy.engine import Connection, make_url
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.database import create_database_engine
from app.models import Competition, Match, User, UserRole
from app.schemas.competitions import CompetitionCreate, LeagueCompetitionDetail
from app.services import competitions as service
from app.services.matches import seoul_today

DOMAIN_TABLES = {
    "competitions",
    "competition_members",
    "league_fixtures",
    "competition_teams",
    "competition_team_members",
    "team_encounters",
    "team_single_games",
    "team_doubles_games",
}
REPORT_STEM = "competition-demo-scenarios-2026-09-10"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise RuntimeError(message)


def local_database() -> Path:
    settings = get_settings()
    require(
        settings.environment.strip().lower() in {"development", "local", "test", "testing"},
        "Refusing to seed an environment other than development/local/test.",
    )
    require(not os.environ.get("RENDER"), "Refusing to run in a Render deployment.")
    url = make_url(settings.sqlalchemy_database_url)
    require(url.drivername in {"sqlite", "sqlite+pysqlite"}, "Only local SQLite is allowed.")
    require(bool(url.database) and not url.query and not url.host, "Ambiguous database URL.")
    expected = BACKEND / "scutta.db"
    require(not expected.is_symlink(), "The local database must not be a symbolic link.")
    database = Path(url.database or "").resolve(strict=True)
    require(database == expected, f"The database must be exactly {expected}.")
    require(database.is_file(), "The existing local database is required.")
    return database


def fingerprint(connection: Connection, *, protected_only: bool = False) -> dict[str, Any]:
    tables = connection.exec_driver_sql(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' "
        "ORDER BY name"
    ).scalars()
    result = {}
    for table in list(tables):
        if protected_only and table in DOMAIN_TABLES:
            continue
        quoted = '"' + table.replace('"', '""') + '"'
        where = " WHERE kind != 'competition'" if protected_only and table == "matches" else ""
        rows = connection.exec_driver_sql(f"SELECT * FROM {quoted}{where}").all()
        serialized = sorted(json.dumps(tuple(row), default=str, ensure_ascii=False) for row in rows)
        result[table] = {
            "count": len(rows),
            "sha256": hashlib.sha256("\n".join(serialized).encode("utf-8")).hexdigest(),
        }
    return result


def database_checks(connection: Connection) -> dict[str, Any]:
    integrity = connection.exec_driver_sql("PRAGMA integrity_check").scalars().all()
    foreign_keys = [tuple(row) for row in connection.exec_driver_sql("PRAGMA foreign_key_check")]
    require(integrity == ["ok"], f"SQLite integrity check failed: {integrity}")
    require(not foreign_keys, f"Foreign-key check failed: {foreign_keys}")
    return {"integrity_check": integrity, "foreign_key_check": foreign_keys}


def backup_database(database: Path) -> Path:
    directory = BACKEND / ".backups"
    directory.mkdir(exist_ok=True)
    destination = directory / f"before-competition-demo-{datetime.now():%Y%m%d-%H%M%S-%f}.db"
    with destination.open("xb"):
        pass
    # The caller holds BEGIN IMMEDIATE but has not changed any rows yet. A
    # separate read-only connection can back up that stable committed snapshot.
    with (
        closing(sqlite3.connect(database.as_uri() + "?mode=ro", uri=True)) as source,
        closing(sqlite3.connect(destination)) as target,
    ):
        source.backup(target)
        require(target.execute("PRAGMA integrity_check").fetchall() == [("ok",)], "Bad backup.")
    return destination


@dataclass
class Scenario:
    name: str
    kind: str
    mode: str
    players: list[int]
    expected_completed: int
    expected_total: int
    expected_status: str
    lesson: str
    cohort: str = ""
    competition_id: int = 0


def scenarios(ids: list[int]) -> list[Scenario]:
    team_specs = [
        ("미시작", "empty", 0, "active", "5팀 편성, 전체 대진, 결과 입력 전 상태"),
        ("단식 진행", "partial", 0, "active", "서로 다른 대결의 단식 1·2·3개 진행"),
        ("3대1 승부", "three_one", 1, "active", "4단식 완료, 복식 없이 승부 결정"),
        ("4대0 완승", "sweep", 1, "active", "4단식 전승, 상대 팀 방향의 승리 표시"),
        ("복식 대기", "pending", 0, "active", "10대결 모두 2:2, 패배자 복식 자동 선정"),
        ("혼합 진행", "mixed", 3, "active", "3:1·4:0·복식 완료·복식 대기·부분 단식 혼합"),
        ("완료 직전", "nearly", 9, "active", "마지막 복식 대기, 미완료 종료 요청 거절"),
        ("전원 동률·전체 완료", "tie", 10, "completed", "5팀 모두 2승2패, 공동 1위·자동 완료"),
        ("수동 종료", "closed", 10, "closed", "다양한 점수와 복식 승부 후 수동 종료"),
        ("정정 후 재개", "reopened", 9, "active", "종료 후 단식 승패 정정으로 복식 생성·재개"),
    ]
    result = [
        Scenario(f"단체{index:02d} · {name}", "team", mode, ids, done, 10, status, lesson)
        for index, (name, mode, done, status, lesson) in enumerate(team_specs, 1)
    ]
    groups = [
        (
            "5인조",
            [5, 5, 5, 5],
            [
                ("미시작", "empty", 0, "active"),
                ("초반 진행", "partial", 3, "active"),
                ("완료 직전", "nearly", 9, "active"),
                ("전원 동률·전체 완료", "tie", 10, "completed"),
            ],
        ),
        (
            "4인조",
            [4, 4, 4, 4, 4],
            [
                ("미시작", "empty", 0, "active"),
                ("초반 진행", "partial", 2, "active"),
                ("수동 종료", "closed", 6, "closed"),
                ("삭제 후 재개", "reopened", 5, "active"),
                ("종료 후 승패 정정", "corrected", 6, "closed"),
            ],
        ),
        (
            "6·6·4·4인조",
            [6, 6, 4, 4],
            [
                ("첫 라운드", "partial", 3, "active"),
                ("전체 완료", "filled", 15, "completed"),
                ("미시작", "empty", 0, "active"),
                ("종료 후 날짜 정정", "redated", 6, "closed"),
            ],
        ),
    ]
    for cohort, sizes, specifications in groups:
        offset = 0
        assigned = []
        for index, (size, specification) in enumerate(zip(sizes, specifications, strict=True)):
            name, mode, done, status = specification
            members = ids[offset : offset + size]
            assigned.extend(members)
            offset += size
            result.append(
                Scenario(
                    f"개인 {cohort} · {chr(65 + index)}조 · {name}",
                    "league",
                    mode,
                    members,
                    done,
                    size * (size - 1) // 2,
                    status,
                    name,
                    cohort,
                )
            )
        require(len(assigned) == 20 and set(assigned) == set(ids), f"Invalid cohort: {cohort}")
    return result


class Seeder:
    def __init__(self, db: Session, players: list[User], admin: User) -> None:
        self.db = db
        self.players = players
        self.admin = admin
        self.used_dates = set(db.scalars(select(Match.played_on)))
        self.next_day = seoul_today() - timedelta(days=1)
        self.rejected_closes: list[dict[str, Any]] = []

    def reserve_day(self):
        while self.next_day in self.used_dates:
            self.next_day -= timedelta(days=1)
        result = self.next_day
        self.used_dates.add(result)
        self.next_day -= timedelta(days=1)
        return result

    def detail(self, item: Scenario, actor_id: int | None = None):
        return service.get_competition_detail(self.db, item.competition_id, actor_id=actor_id)

    def create(self, item: Scenario) -> None:
        payload: dict[str, Any] = {"name": item.name, "type": item.kind}
        if item.kind == "league":
            payload["participant_ids"] = item.players
        else:
            payload["teams"] = [
                {"name": chr(65 + index), "member_ids": item.players[index * 4 : index * 4 + 4]}
                for index in range(5)
            ]
        item.competition_id = service.create_competition(
            self.db, payload=CompetitionCreate(**payload)
        )

    def reject_close(self, item: Scenario) -> None:
        try:
            service.complete_competition(self.db, competition_id=item.competition_id)
        except service.CompetitionConflictError as error:
            # Only the current Session savepoint is rolled back. Previously
            # released service savepoints remain within the outer transaction.
            self.db.rollback()
            self.rejected_closes.append({"id": item.competition_id, "message": str(error)})
        else:
            raise RuntimeError("Incomplete competition unexpectedly accepted completion.")

    def fill_league(self, item: Scenario, played_on) -> None:
        detail = self.detail(item)
        count = (
            item.expected_completed
            if item.mode in {"empty", "partial", "nearly"}
            else len(detail.fixtures)
        )
        positions = {player_id: index for index, player_id in enumerate(item.players)}
        for index, fixture in enumerate(detail.fixtures[:count]):
            left = positions[fixture.player1.id]
            right = positions[fixture.player2.id]
            left_wins = (right - left) % 5 in {1, 2} if item.mode == "tie" else index % 3 != 1
            high, low = (3, 0) if item.mode == "tie" or index % 2 == 0 else (2, 1)
            service.put_admin_league_result(
                self.db,
                competition_id=item.competition_id,
                fixture_id=fixture.id,
                score1=high if left_wins else low,
                score2=low if left_wins else high,
                played_on=played_on,
            )
        if item.mode in {"closed", "reopened", "corrected", "redated"}:
            service.complete_competition(self.db, competition_id=item.competition_id)
        if item.mode == "reopened":
            service.delete_admin_league_result(
                self.db, competition_id=item.competition_id, fixture_id=detail.fixtures[-1].id
            )
        if item.mode in {"corrected", "redated"}:
            fixture = self.detail(item).fixtures[0]
            service.put_admin_league_result(
                self.db,
                competition_id=item.competition_id,
                fixture_id=fixture.id,
                score1=fixture.score2 if item.mode == "corrected" else fixture.score1,
                score2=fixture.score1 if item.mode == "corrected" else fixture.score2,
                played_on=self.reserve_day() if item.mode == "redated" else played_on,
            )
        if item.mode == "nearly":
            self.reject_close(item)

    def team_singles(self, item: Scenario, encounter, winners: list[bool], played_on) -> None:
        for index, left_wins in enumerate(winners):
            high, low = (3, 0) if item.mode == "tie" or index % 2 == 0 else (2, 1)
            service.post_admin_team_single(
                self.db,
                competition_id=item.competition_id,
                encounter_id=encounter.id,
                team1_player_id=encounter.team1.members[index].id,
                team2_player_id=encounter.team2.members[index].id,
                score1=high if left_wins else low,
                score2=low if left_wins else high,
                played_on=played_on,
            )

    def fill_team(self, item: Scenario, played_on) -> None:
        detail = self.detail(item)
        positions = {team.id: index for index, team in enumerate(detail.teams)}
        for index, encounter in enumerate(detail.encounters):
            winners, double_done = [], False
            if item.mode == "partial" and index < 3:
                winners = [True, False, True][: index + 1]
            elif item.mode == "three_one" and index == 0:
                winners = [True, True, True, False]
            elif item.mode == "sweep" and index == 0:
                winners = [False] * 4
            elif item.mode == "pending":
                winners = [True, True, False, False]
            elif item.mode == "mixed" and index < 5:
                winners = [
                    [True, True, True, False],
                    [False] * 4,
                    [True, False, True, False],
                    [False, True, False, True],
                    [True, False],
                ][index]
                double_done = index == 2
            elif item.mode == "nearly":
                winners = [True, True, True, False] if index < 9 else [True, True, False, False]
            elif item.mode == "tie":
                left_wins = (positions[encounter.team2.id] - positions[encounter.team1.id]) % 5 in {
                    1,
                    2,
                }
                winners = [left_wins] * 3 + [not left_wins]
            elif item.mode == "closed":
                winners = [[True, True, True, False], [False] * 4, [True, False, True, False]][
                    index % 3
                ]
                double_done = index % 3 == 2
            elif item.mode == "reopened":
                winners = [True, True, True, False]
            self.team_singles(item, encounter, winners, played_on)
            if double_done:
                service.put_admin_team_doubles(
                    self.db,
                    competition_id=item.competition_id,
                    encounter_id=encounter.id,
                    admin=self.admin,
                    score1=1 if index % 2 else 2,
                    score2=2 if index % 2 else 1,
                    played_on=played_on,
                )
        if item.mode in {"closed", "reopened"}:
            service.complete_competition(self.db, competition_id=item.competition_id)
        if item.mode == "reopened":
            single = self.detail(item).encounters[0].singles[2]
            service.put_admin_team_single(
                self.db,
                competition_id=item.competition_id,
                single_id=single.id,
                team1_player_id=single.team1_player.id,
                team2_player_id=single.team2_player.id,
                score1=0,
                score2=3,
                played_on=played_on,
            )
        if item.mode == "nearly":
            self.reject_close(item)

    def validate(self, item: Scenario) -> dict[str, Any]:
        detail = self.detail(item)
        require(
            (detail.completed_count, detail.total_count, detail.status.value)
            == (item.expected_completed, item.expected_total, item.expected_status),
            f"Unexpected progress: {item.name}",
        )
        require(
            (detail.completed_at is not None) == (item.expected_status in {"completed", "closed"}),
            "Bad completion time.",
        )
        require(not detail.is_participant, "Admin must not be marked as a participant.")
        if item.mode == "tie":
            require(len(detail.standings) == 5, "The tied example must have five entrants.")
            require(
                all(row.rank == 1 and row.wins == row.losses == 2 for row in detail.standings),
                "Cyclic standings are not tied.",
            )
        if item.kind == "team":
            pending = [
                enc.doubles
                for enc in detail.encounters
                if enc.doubles and not enc.doubles.completed
            ]
            expected_pending = {"pending": 10, "mixed": 1, "nearly": 1, "reopened": 1}.get(
                item.mode, 0
            )
            require(len(pending) == expected_pending, f"Unexpected pending doubles: {item.name}")
        for player in self.players:
            view = self.detail(item, player.id)
            require(view.is_participant == (player.id in item.players), "Wrong participant flag.")
            if isinstance(view, LeagueCompetitionDetail):
                for fixture in view.fixtures:
                    expected = (
                        item.expected_status == "active"
                        and not fixture.completed
                        and player.id in {fixture.player1.id, fixture.player2.id}
                    )
                    require(fixture.can_submit == expected, "Wrong league submit permission.")
            else:
                for encounter in view.encounters:
                    member_ids = {
                        member.id
                        for team in (encounter.team1, encounter.team2)
                        for member in team.members
                    }
                    writable = item.expected_status == "active" and player.id in member_ids
                    require(
                        encounter.can_submit_singles == (writable and len(encounter.singles) < 4),
                        "Wrong singles permission.",
                    )
                    require(
                        encounter.can_submit_doubles
                        == (
                            writable
                            and encounter.doubles is not None
                            and not encounter.doubles.completed
                        ),
                        "Wrong doubles permission.",
                    )
        return {
            "id": item.competition_id,
            "name": item.name,
            "type": item.kind,
            "url": f"http://127.0.0.1:8000/competitions/{item.competition_id}",
            "status": detail.status.value,
            "completed_count": detail.completed_count,
            "total_count": detail.total_count,
            "cohort": item.cohort,
            "player_ids": item.players,
            "checks": item.lesson,
            "detail": detail.model_dump(mode="json"),
        }


def write_report(report: dict[str, Any]) -> None:
    directory = ROOT / "output"
    directory.mkdir(exist_ok=True)
    (directory / f"{REPORT_STEM}.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    mode = "적용 완료" if report["applied"] else "미적용 미리보기 — DB 전체 롤백 확인"
    lines = [
        f"# 20인 대회 샘플: {mode}",
        "",
        "사용 선수: test1 ~ test20 (기존 계정 유지)",
        f"관리자: {report['admin']}",
        f"백업: {report['backup'] or 'dry-run: 생성하지 않음'}",
        "",
        "상태는 생성 시점 기준: active=진행 중, completed=전체 결과 입력 완료, closed=종료.",
        "전체 결과 입력 시 실제 입력 시각으로 자동 완료되며, "
        "한국 완료일의 다음 날 0시에 자동 종료됩니다.",
        "수동 종료 사례는 즉시 closed가 되며, 종료 후에도 완료 시각은 보존됩니다.",
        "",
    ]
    if not report["applied"]:
        lines.extend(["미적용 미리보기의 링크는 --apply 적용 후 사용할 수 있습니다.", ""])
    lines.extend(
        [
            "| 대회 | 상태 | 진행 | 확인 내용 |",
            "|---|---|---|---|",
        ]
    )
    for item in report["scenarios"]:
        lines.append(
            f"| [{item['name']}]({item['url']}) | {item['status']} | "
            f"{item['completed_count']}/{item['total_count']} | {item['checks']} |"
        )
    lines.extend(
        [
            "",
            "기존 계정·세션·일반 경기·미니게임·설정 행 fingerprint 일치.",
            "SQLite integrity_check=ok, foreign_key_check 이상 없음.",
            "개인리그 3세트는 각각 20명 전원 중복 없이 배정. 선수별 참가·제출 가능 상태 확인.",
            f"미완료 종료 거절 확인: {len(report['rejected_closes'])}건.",
            "",
        ]
    )
    (directory / f"{REPORT_STEM}.md").write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true", help="Back up and commit the local replacement."
    )
    args = parser.parse_args()
    database = local_database()
    engine = create_database_engine(f"sqlite:///{database.as_posix()}")
    backup = None
    try:
        with engine.connect() as connection:
            connection.exec_driver_sql("BEGIN IMMEDIATE")
            try:
                require(
                    connection.exec_driver_sql("PRAGMA foreign_keys").scalar() == 1,
                    "Foreign keys must be enabled.",
                )
                database_checks(connection)
                before = fingerprint(connection)
                protected = fingerprint(connection, protected_only=True)
                if args.apply:
                    backup = backup_database(database)
                with Session(
                    bind=connection,
                    autoflush=False,
                    expire_on_commit=False,
                    join_transaction_mode="create_savepoint",
                ) as db:
                    names = [f"test{index}" for index in range(1, 21)]
                    by_name = {
                        user.username: user
                        for user in db.scalars(select(User).where(User.username.in_(names)))
                    }
                    require(
                        set(by_name) == set(names),
                        "The existing test1 through test20 accounts are required.",
                    )
                    players = [by_name[name] for name in names]
                    require(
                        all(player.role == UserRole.PLAYER for player in players),
                        "All test accounts must be players.",
                    )
                    admin = db.scalar(
                        select(User).where(
                            User.username == "local-admin", User.role == UserRole.ADMIN
                        )
                    )
                    require(
                        admin is not None, "The existing local-admin administrator is required."
                    )
                    old_ids = list(db.scalars(select(Competition.id).order_by(Competition.id)))
                    items = scenarios([player.id for player in players])
                    seeder = Seeder(db, players, admin)
                    for item in items:
                        seeder.create(item)
                    require(
                        min(item.competition_id for item in items) > max(old_ids, default=0),
                        "New competition IDs must exceed all previous IDs.",
                    )
                    for item in items:
                        played_on = seeder.reserve_day()
                        if item.kind == "team":
                            seeder.fill_team(item, played_on)
                        else:
                            seeder.fill_league(item, played_on)
                    for competition_id in old_ids:
                        service.delete_competition(db, competition_id=competition_id)
                    require(
                        set(db.scalars(select(Competition.id)))
                        == {item.competition_id for item in items},
                        "Unexpected competitions remain.",
                    )
                    snapshots = [seeder.validate(item) for item in items]
                    db.rollback()  # End the final read savepoint before the outer decision.
                    report = {
                        "applied": args.apply,
                        "database": str(database),
                        "generated_at": datetime.now().astimezone().isoformat(),
                        "backup": str(backup) if backup else None,
                        "admin": admin.username,
                        "players": [
                            {"id": player.id, "username": player.username} for player in players
                        ],
                        "removed_competition_ids": old_ids,
                        "scenarios": snapshots,
                        "rejected_closes": seeder.rejected_closes,
                    }
                require(
                    fingerprint(connection, protected_only=True) == protected,
                    "Protected rows changed; aborting replacement.",
                )
                report["checks"] = database_checks(connection)
                report["before"] = before
                report["preview_after"] = fingerprint(connection)
                report["protected_rows"] = protected
                if args.apply:
                    connection.commit()
                else:
                    connection.rollback()
                persisted = fingerprint(connection)
                require(
                    persisted == (report["preview_after"] if args.apply else before),
                    "Post-transaction fingerprint mismatch.",
                )
                report["persisted_after"] = persisted
                report["rollback_verified"] = not args.apply
            except BaseException:
                connection.rollback()
                raise
        write_report(report)
        print(
            json.dumps(
                {
                    "applied": args.apply,
                    "competitions": len(report["scenarios"]),
                    "backup": report["backup"],
                    "rollback_verified": report["rollback_verified"],
                    "report": str(ROOT / "output" / f"{REPORT_STEM}.md"),
                },
                ensure_ascii=False,
            )
        )
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
