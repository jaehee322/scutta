# syntax=docker/dockerfile:1

FROM node:24.11.1-bookworm-slim AS frontend-builder

WORKDIR /app/frontend

RUN corepack enable && corepack prepare pnpm@11.19.0 --activate

COPY frontend/package.json frontend/pnpm-lock.yaml frontend/pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY frontend/ ./
RUN pnpm build && pnpm verify:build


FROM python:3.12.13-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=10000

WORKDIR /app/backend

COPY backend/pyproject.toml backend/README.md ./
COPY backend/app ./app
RUN python -m pip install --no-cache-dir .

COPY backend/alembic.ini ./
COPY backend/migrations ./migrations
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

RUN groupadd --system --gid 10001 scutta \
    && useradd --system --uid 10001 --gid scutta --home-dir /app scutta \
    && chown -R scutta:scutta /app

USER scutta

CMD ["sh", "-c", "alembic upgrade head && python -m app.cli ensure-admin && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
