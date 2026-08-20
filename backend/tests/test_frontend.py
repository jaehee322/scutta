from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.core.config import get_settings
from app.main import create_app


def _write_frontend(frontend_dist: Path) -> None:
    (frontend_dist / "assets").mkdir(parents=True)
    (frontend_dist / "index.html").write_text(
        "<!doctype html><title>SCUTTA</title><div id='root'></div>",
        encoding="utf-8",
    )
    (frontend_dist / "manifest.webmanifest").write_text(
        '{"name":"SCUTTA"}',
        encoding="utf-8",
    )
    (frontend_dist / "assets" / "app.js").write_text(
        "window.SCUTTA = true;",
        encoding="utf-8",
    )
    (frontend_dist / "assets" / "large.js").write_text(
        "const value = 'SCUTTA';\n" * 100,
        encoding="utf-8",
    )
    (frontend_dist / "sw.js").write_text("self.skipWaiting();", encoding="utf-8")


def test_frontend_files_and_spa_routes_are_served(tmp_path: Path) -> None:
    _write_frontend(tmp_path)
    client = TestClient(create_app(frontend_dist=tmp_path))

    navigation_headers = {"Accept": "text/html"}
    root = client.get("/", headers=navigation_headers)
    fallback = client.get("/rankings", headers=navigation_headers)
    assert "SCUTTA" in root.text
    assert "SCUTTA" in fallback.text
    assert "SCUTTA" in client.get("/admin/players", headers=navigation_headers).text
    asset = client.get("/assets/app.js")
    compressed_asset = client.get("/assets/large.js", headers={"Accept-Encoding": "gzip"})
    service_worker = client.get("/sw.js")
    assert asset.text == "window.SCUTTA = true;"
    manifest = client.get("/manifest.webmanifest")
    assert manifest.json() == {"name": "SCUTTA"}
    assert service_worker.headers["content-type"].startswith("text/javascript")
    assert root.headers["cache-control"] == "no-cache"
    assert fallback.headers["cache-control"] == "no-cache"
    assert service_worker.headers["cache-control"] == "no-cache"
    assert manifest.headers["cache-control"] == "no-cache"
    assert asset.headers["cache-control"] == "public, max-age=31536000, immutable"
    assert compressed_asset.headers["content-encoding"] == "gzip"
    assert compressed_asset.headers["vary"] == "Accept-Encoding"
    assert int(compressed_asset.headers["content-length"]) < len(compressed_asset.content)
    assert compressed_asset.text.splitlines() == ["const value = 'SCUTTA';"] * 100

    missing_asset = client.get("/assets/missing.js")
    assert missing_asset.status_code == 404
    assert "SCUTTA" not in missing_asset.text
    missing_script_navigation = client.get(
        "/missing.js",
        headers={"Accept": "text/html"},
    )
    assert missing_script_navigation.status_code == 404


def test_frontend_fallback_does_not_hide_api_errors(tmp_path: Path) -> None:
    _write_frontend(tmp_path)
    client = TestClient(create_app(frontend_dist=tmp_path))

    missing_api = client.get("/api/v1/does-not-exist")
    assert missing_api.status_code == 404
    assert missing_api.json() == {"detail": "Not Found"}
    missing_api_post = client.post("/api/v1/does-not-exist", json={})
    assert missing_api_post.status_code == 404
    assert missing_api_post.json() == {"detail": "Not Found"}
    assert client.post("/api", json={}).json() == {"detail": "Not Found"}
    health = client.get("/health")
    assert health.json() == {"status": "ok"}
    assert health.headers["cache-control"] == "no-store"
    assert health.headers["x-content-type-options"] == "nosniff"
    assert health.headers["x-frame-options"] == "DENY"
    assert "content-security-policy" not in health.headers
    assert client.get("/openapi.json").status_code == 200


def test_production_uses_security_headers_and_hides_openapi(tmp_path: Path) -> None:
    _write_frontend(tmp_path)
    settings = get_settings()
    original_environment = settings.environment
    settings.environment = "production"
    try:
        client = TestClient(create_app(frontend_dist=tmp_path))
        response = client.get("/")
        assert "frame-ancestors 'none'" in response.headers["content-security-policy"]
        assert response.headers["strict-transport-security"].startswith("max-age=31536000")
        assert client.get("/openapi.json").status_code == 404
    finally:
        settings.environment = original_environment


def test_missing_optional_frontend_keeps_development_api_available(tmp_path: Path) -> None:
    client = TestClient(create_app(frontend_dist=tmp_path / "missing"))

    assert client.get("/health").json() == {"status": "ok"}
    assert client.get("/").status_code == 404


def test_missing_production_frontend_fails_fast(tmp_path: Path) -> None:
    settings = get_settings()
    original_environment = settings.environment
    settings.environment = "production"
    try:
        with pytest.raises(RuntimeError, match="frontend build not found"):
            create_app(frontend_dist=tmp_path / "missing")
    finally:
        settings.environment = original_environment
