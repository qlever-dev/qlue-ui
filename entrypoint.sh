#!/bin/sh
set -e

echo "Starting API server..."
cd /app/src && uvicorn main:app --host 0.0.0.0 --port 8000 &

echo "Starting Caddy..."
exec "$@"
