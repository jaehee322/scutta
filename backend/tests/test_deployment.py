from pathlib import Path

import yaml

REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


def test_render_blueprint_has_one_same_origin_app_and_paid_database() -> None:
    blueprint = yaml.safe_load((REPOSITORY_ROOT / "render.yaml").read_text(encoding="utf-8"))

    services = blueprint["services"]
    assert len(services) == 1
    app = services[0]
    assert app["name"] == "scutta-app"
    assert app["type"] == "web"
    assert app["runtime"] == "docker"
    assert app["plan"] == "free"
    assert app["dockerfilePath"] == "./Dockerfile"
    assert app["healthCheckPath"] == "/health"

    env = {item["key"]: item.get("value") for item in app["envVars"] if "key" in item}
    assert env["CORS_ORIGINS"] == "[]"
    assert env["SESSION_COOKIE_SECURE"] == "true"
    assert env["SESSION_COOKIE_SAMESITE"] == "lax"
    assert "VITE_API_URL" not in env

    databases = blueprint["databases"]
    assert len(databases) == 1
    database = databases[0]
    assert database["name"] == "scutta-db"
    assert database["plan"] == "basic-256mb"
    assert database["diskSizeGB"] == 1


def test_dockerfile_builds_frontend_into_python_runtime() -> None:
    dockerfile = (REPOSITORY_ROOT / "Dockerfile").read_text(encoding="utf-8")

    assert "AS frontend-builder" in dockerfile
    assert "pnpm verify:build" in dockerfile
    assert "COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist" in dockerfile
    assert "alembic upgrade head" in dockerfile
    assert "python -m app.cli ensure-admin" in dockerfile
    assert "uvicorn app.main:app" in dockerfile
    assert "--proxy-headers" in dockerfile
    assert "--forwarded-allow-ips='*'" in dockerfile


def test_dockerignore_excludes_local_secrets_and_package_stores() -> None:
    patterns = {
        line.strip()
        for line in (REPOSITORY_ROOT / ".dockerignore").read_text(encoding="utf-8").splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    }

    assert {".env", ".env.*", "**/.env", "**/.env.*"} <= patterns
    assert {".pnpm-store", "**/.pnpm-store"} <= patterns
