#!/bin/sh
# entrypoint.sh — Container startup script
#
# Responsibilities:
#   1. Substitute ${PORT} in the nginx config template using the Cloud Run
#      $PORT env var (defaults to 8080 if not set).
#   2. Hand off execution to supervisord which manages all three processes:
#      nginx (reverse proxy), uvicorn (FastAPI), node (Next.js).
#
# Using 'exec' for supervisord ensures it becomes PID 1 and receives
# SIGTERM correctly from Cloud Run during graceful shutdown.

set -e

export PORT="${PORT:-8080}"
echo "[entrypoint] Starting with PORT=${PORT}"

# Generate the nginx config from the template, replacing only ${PORT}
envsubst '${PORT}' < /etc/nginx/nginx.conf.template > /etc/nginx/conf.d/app.conf

# Remove the default nginx site if present
rm -f /etc/nginx/sites-enabled/default

echo "[entrypoint] nginx config written, starting supervisord..."
exec /usr/bin/supervisord -n -c /etc/supervisord.conf
