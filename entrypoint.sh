#!/bin/sh

set -e

echo "Running database migrations..."
python ./api/manage.py migrate --noinput

echo "Syncing configuration"

echo "Starting internal API server"
cd ./api && gunicorn --bind 0.0.0.0:8000 --workers 3 configuration.wsgi:application &

echo "Starting Caddy application..."
exec "$@"
