from __future__ import annotations

from pathlib import Path, PurePosixPath
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from starlette.datastructures import Headers
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api import admin, auth, competitions, matches, players, rankings, settlements
from app.api.deps import DbSession
from app.core.config import get_settings

DEFAULT_FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "dist"
RESERVED_FRONTEND_PATHS = frozenset({"api", "docs", "health", "openapi.json", "redoc"})


class SpaStaticFiles(StaticFiles):
    """Serve built frontend files and fall back to index.html for client routes."""

    @staticmethod
    def _set_cache_control(response, path: str, *, spa_fallback: bool = False):
        normalized_path = path.replace("\\", "/")
        if spa_fallback or normalized_path in {
            "",
            ".",
            "index.html",
            "manifest.webmanifest",
            "sw.js",
        }:
            response.headers["Cache-Control"] = "no-cache"
        elif normalized_path.startswith("assets/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return response

    async def get_response(self, path: str, scope):
        root_path = path.partition("/")[0]
        if root_path in RESERVED_FRONTEND_PATHS:
            raise StarletteHTTPException(status_code=status.HTTP_404_NOT_FOUND)

        try:
            response = await super().get_response(path, scope)
        except StarletteHTTPException as exc:
            if exc.status_code != status.HTTP_404_NOT_FOUND:
                raise
        else:
            if response.status_code != status.HTTP_404_NOT_FOUND:
                return self._set_cache_control(response, path)

        accept = Headers(scope=scope).get("accept", "")
        if PurePosixPath(path).suffix or "text/html" not in accept:
            raise StarletteHTTPException(status_code=status.HTTP_404_NOT_FOUND)

        response = await super().get_response("index.html", scope)
        return self._set_cache_control(response, path, spa_fallback=True)


def mount_frontend(
    application: FastAPI,
    frontend_dist: Path,
    *,
    required: bool,
) -> None:
    index_file = frontend_dist / "index.html"
    if not index_file.is_file():
        if required:
            raise RuntimeError(f"frontend build not found: {index_file}")
        return

    application.mount(
        "/",
        SpaStaticFiles(directory=frontend_dist, html=True),
        name="frontend",
    )


def create_app(frontend_dist: Path | None = None) -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/docs" if settings.environment != "production" else None,
        redoc_url=None,
        openapi_url="/openapi.json" if settings.environment != "production" else None,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )
    application.add_middleware(GZipMiddleware, minimum_size=1_000, compresslevel=5)

    unsafe_methods = frozenset({"POST", "PUT", "PATCH", "DELETE"})
    allowed_origins = frozenset(settings.cors_origins)

    def add_security_headers(response, path: str):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        if settings.environment.strip().lower() == "production":
            response.headers["Content-Security-Policy"] = (
                "default-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; "
                "form-action 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; "
                "img-src 'self' data:; font-src 'self' data:; connect-src 'self'; "
                "manifest-src 'self'; worker-src 'self'"
            )
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        if path == "/health" or path.startswith("/api/"):
            response.headers["Cache-Control"] = "no-store"
        return response

    @application.middleware("http")
    async def enforce_origin(request: Request, call_next):
        origin = request.headers.get("origin")
        same_origin = False
        if origin is not None:
            parsed_origin = urlsplit(origin)
            forwarded_proto = request.headers.get("x-forwarded-proto", request.url.scheme)
            same_origin = (
                parsed_origin.scheme == forwarded_proto
                and parsed_origin.netloc.casefold() == request.headers.get("host", "").casefold()
                and not parsed_origin.path
                and not parsed_origin.query
                and not parsed_origin.fragment
            )
        if (
            request.method in unsafe_methods
            and origin is not None
            and not (same_origin or origin in allowed_origins)
        ):
            return add_security_headers(
                JSONResponse(
                    status_code=status.HTTP_403_FORBIDDEN,
                    content={"detail": "허용되지 않은 요청 출처입니다."},
                ),
                request.url.path,
            )
        response = await call_next(request)
        return add_security_headers(response, request.url.path)

    @application.get("/health", tags=["system"])
    def health(db: DbSession) -> dict[str, str]:
        try:
            db.execute(text("SELECT 1"))
        except SQLAlchemyError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Database unavailable",
            ) from exc
        return {"status": "ok"}

    api_prefix = "/api/v1"
    application.include_router(auth.router, prefix=api_prefix)
    application.include_router(players.router, prefix=api_prefix)
    application.include_router(matches.router, prefix=api_prefix)
    application.include_router(rankings.router, prefix=api_prefix)
    application.include_router(settlements.router, prefix=api_prefix)
    application.include_router(competitions.router, prefix=api_prefix)
    application.include_router(admin.router, prefix=api_prefix)
    application.include_router(matches.admin_router, prefix=api_prefix)
    application.include_router(competitions.admin_router, prefix=api_prefix)

    missing_api_methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]

    @application.api_route(
        "/api",
        methods=missing_api_methods,
        include_in_schema=False,
    )
    @application.api_route(
        "/api/{path:path}",
        methods=missing_api_methods,
        include_in_schema=False,
    )
    def missing_api_route(path: str | None = None) -> None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not Found")

    mount_frontend(
        application,
        frontend_dist or DEFAULT_FRONTEND_DIST,
        required=settings.environment.strip().lower() == "production",
    )

    return application


app = create_app()
