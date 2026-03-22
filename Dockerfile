# ---- Stage 1: Build the UI app ----
FROM node:22-alpine AS ui-builder

WORKDIR /app

ARG BASE_URL
ARG GIT_COMMIT
ENV VITE_API_URL=${BASE_URL}
ENV VITE_GIT_COMMIT=${GIT_COMMIT}

# Install node dependencies
COPY ./frontend/package*.json ./
RUN npm ci
# Build static files
COPY ./frontend .
RUN npm run build

# ---- Stage 2: Build the API app ----
FROM python:3.13-slim AS builder

WORKDIR /app

# Set environment variables to optimize Python
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Upgrade pip and install dependencies
RUN pip install --upgrade pip
COPY ./backend/pyproject.toml .
RUN pip install --no-cache-dir .

# ---- Stage 3: Final image ----
FROM python:3.13-slim

RUN useradd -m -r -u 1000 appuser && \
	mkdir /app && \
	chown -R appuser /app

# Copy the Python dependencies from the builder stage
COPY --from=builder /usr/local/lib/python3.13/site-packages/ /usr/local/lib/python3.13/site-packages/
COPY --from=builder /usr/local/bin/ /usr/local/bin/

# Set the working directory
WORKDIR /app

# Copy API application code
COPY --chown=appuser:appuser ./backend ./api

# Copy frontend build from Stage 1
COPY --from=ui-builder /app/dist ./frontend_dist

# Set environment variables to optimize Python
ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

# Switch to non-root user
USER appuser

# Collect static files
RUN python ./api/manage.py collectstatic --noinput

# Install caddy
COPY --from=caddy:2 /usr/bin/caddy /usr/bin/caddy
COPY Caddyfile .

# Expose the application port
EXPOSE 7000

# setup entrypoint script
COPY entrypoint.sh /entrypoint.sh
# RUN chmod +x /entrypoint.sh
ENTRYPOINT ["/entrypoint.sh"]

# Start the application using Gunicorn
CMD ["caddy", "run"]
