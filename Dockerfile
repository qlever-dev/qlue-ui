# ---- Stage 1: Build the frontend ----
FROM node:24.20.0-alpine AS frontend

WORKDIR /app

ARG GIT_COMMIT
ENV VITE_GIT_COMMIT=${GIT_COMMIT}

COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ .
RUN npm run build

# ---- Stage 2: Install Python dependencies ----
FROM python:3.14-slim AS builder

COPY --from=ghcr.io/astral-sh/uv:0.12.13 /uv /uvx /bin/

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0

WORKDIR /app

# RUN --mount=type=cache,target=/root/.cache/uv \
#     --mount=type=bind,source=backend/pyproject.toml,target=pyproject.toml \
#     --mount=type=bind,source=backend/uv.lock,target=uv.lock \
#     uv sync --locked --no-install-project --no-dev
COPY backend/pyproject.toml backend/uv.lock ./
RUN uv sync --locked --no-install-project --no-dev

# ---- Stage 3: Final image ----
FROM python:3.14-slim

RUN useradd -m -r -u 1000 appuser && \
    mkdir /app && \
    chown -R appuser /app

WORKDIR /app

COPY --from=builder /app/.venv .venv/
COPY --chown=appuser:appuser backend/src/api api/
COPY --from=frontend /app/dist frontend_dist/
# Put the shipped defaults in place at build time, so the running container
# never needs to write to /app to seed them.
COPY --chown=appuser:appuser backend/src/api/defaults/examples examples/
COPY --chown=appuser:appuser backend/src/api/defaults/config.yaml config.yaml

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

USER appuser

EXPOSE 7000

CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "7000", \
    "--proxy-headers", "--forwarded-allow-ips", "*", "--use-colors"]
