from __future__ import annotations

from urllib.parse import urlsplit

from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import admin, auth, matches, players, rankings, settlements
from app.core.config import get_settings


def create_app() -> FastAPI:
    settings = get_settings()
    application = FastAPI(
        title=settings.app_name,
        version="0.1.0",
        docs_url="/docs" if settings.environment != "production" else None,
        redoc_url=None,
    )
    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type"],
    )

    unsafe_methods = frozenset({"POST", "PUT", "PATCH", "DELETE"})
    allowed_origins = frozenset(settings.cors_origins)

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
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"detail": "허용되지 않은 요청 출처입니다."},
            )
        return await call_next(request)

    @application.get("/health", tags=["system"])
    def health() -> dict[str, str]:
        return {"status": "ok"}

    api_prefix = "/api/v1"
    application.include_router(auth.router, prefix=api_prefix)
    application.include_router(players.router, prefix=api_prefix)
    application.include_router(matches.router, prefix=api_prefix)
    application.include_router(rankings.router, prefix=api_prefix)
    application.include_router(settlements.router, prefix=api_prefix)
    application.include_router(admin.router, prefix=api_prefix)
    application.include_router(matches.admin_router, prefix=api_prefix)

    return application


app = create_app()
