from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from app.services import matches


def test_played_at_for_date_preserves_known_seoul_time() -> None:
    existing = datetime(2026, 8, 25, 6, 17, 42, tzinfo=UTC)

    changed = matches.played_at_for_date(date(2026, 7, 3), existing)
    local = matches.played_at_in_seoul(changed)

    assert local is not None
    assert local.isoformat() == "2026-07-03T15:17:42+09:00"


def test_played_at_for_date_fills_unknown_time_from_seoul_now(monkeypatch) -> None:
    fixed_now = datetime(2026, 8, 25, 23, 58, 7, tzinfo=matches.SEOUL)
    monkeypatch.setattr(matches, "seoul_now", lambda: fixed_now)

    changed = matches.played_at_for_date(date(2026, 7, 3))
    local = matches.played_at_in_seoul(changed)

    assert local is not None
    assert local.isoformat() == "2026-07-03T23:58:07+09:00"
    assert changed.utcoffset() == timedelta(0)


def test_sqlite_naive_played_at_is_interpreted_as_utc() -> None:
    stored = datetime(2026, 8, 25, 14, 30)

    local = matches.played_at_in_seoul(stored)

    assert local is not None
    assert local.isoformat() == "2026-08-25T23:30:00+09:00"
