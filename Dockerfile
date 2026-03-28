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

# ---- Stage 2: Final image ----
FROM python:3.14-slim

RUN useradd -m -r -u 1000 appuser && \
    mkdir /app && \
    chown -R appuser /app

WORKDIR /app

# Install Python dependencies
# uv is bind-mounted (not added to the image), cache speeds up rebuilds
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

RUN --mount=from=ghcr.io/astral-sh/uv:0.11.2,source=/uv,target=/bin/uv \
    --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=backend/pyproject.toml,target=pyproject.toml \
    --mount=type=bind,source=backend/uv.lock,target=uv.lock \
    uv sync --locked --no-install-project --no-dev

COPY --chown=appuser:appuser backend/src src/
COPY --chown=appuser:appuser backend/examples examples/
COPY --from=frontend /app/dist frontend_dist/
COPY --from=caddy:2-alpine /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile entrypoint.sh ./

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

USER appuser

EXPOSE 7000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["caddy", "run"]
