# ---- Stage 1: Build the frontend ----
FROM node:22-alpine AS frontend

WORKDIR /app

ARG BASE_URL
ARG GIT_COMMIT
ENV VITE_API_URL=${BASE_URL}
ENV VITE_GIT_COMMIT=${GIT_COMMIT}

COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# ---- Stage 2: Install Python dependencies ----
FROM python:3.14-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.11.2 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0

WORKDIR /app

RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=backend/pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=backend/uv.lock,target=uv.lock \
    uv sync --locked --no-install-project --no-dev

# ---- Stage 3: Final image ----
FROM python:3.14-slim

RUN useradd -m -r -u 1000 appuser && \
    mkdir /app && \
    chown -R appuser /app

WORKDIR /app

COPY --from=builder /app/.venv .venv/
COPY --chown=appuser:appuser backend/src api/src/
COPY --chown=appuser:appuser backend/examples examples/
COPY --from=frontend /app/dist frontend_dist/
COPY --chown=appuser:appuser config.default.yaml config.yaml
RUN mkdir data/ && chown appuser:appuser data/

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

USER appuser

EXPOSE 7000

CMD ["uvicorn", "main:app", "--app-dir", "api/src", "--host", "0.0.0.0", "--port", "7000", "--proxy-headers", "--forwarded-allow-ips", "*"]
