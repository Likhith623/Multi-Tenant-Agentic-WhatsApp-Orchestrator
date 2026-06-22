# =============================================================================
# Multi-Tenant Agentic WhatsApp Orchestrator — Dockerfile
#
# Multi-stage build producing a single image for Google Cloud Run.
# The image runs three processes managed by supervisord:
#   • nginx       — reverse proxy on $PORT (default 8080)
#   • uvicorn     — FastAPI backend on :8000
#   • node        — Next.js frontend (standalone) on :3000
#
# Stages:
#   1. frontend-builder  — npm ci + next build (standalone output)
#   2. backend-builder   — pip install into /venv
#   3. runtime           — lean final image with all three services
# =============================================================================


# =============================================================================
# Stage 1: Frontend Builder
# Produces .next/standalone — a self-contained Next.js server with its own
# node_modules, no global install needed at runtime.
# =============================================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy package manifests first for layer caching
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --prefer-offline

# Pass Supabase public keys as build args so they get baked into the JS bundle.
# These are PUBLIC keys (safe to embed in client JS) — not secrets.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY

# Copy full frontend source
COPY frontend/ .

# Build Next.js in standalone mode (output: 'standalone' in next.config.ts)
RUN npm run build


# =============================================================================
# Stage 2: Backend Dependency Builder
# Installs Python packages into an isolated virtualenv for easy copying.
# =============================================================================
FROM python:3.11-slim AS backend-builder

WORKDIR /build

# Create and activate a virtual environment
RUN python -m venv /venv

# Install dependencies into the venv
COPY backend/requirements.txt .
RUN /venv/bin/pip install --no-cache-dir --upgrade pip && \
    /venv/bin/pip install --no-cache-dir -r requirements.txt


# =============================================================================
# Stage 3: Runtime Image
# =============================================================================
FROM python:3.11-slim AS runtime

# ── System dependencies ───────────────────────────────────────────────────────
# nginx       — reverse proxy (single public port → two internal services)
# supervisor  — process manager for nginx + uvicorn + node
# gettext     — provides envsubst for nginx config template substitution
# curl        — health checks
# nodejs      — to run the Next.js standalone server
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    supervisor \
    gettext-base \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# ── Python venv from builder ──────────────────────────────────────────────────
COPY --from=backend-builder /venv /venv

# ── Backend source files ──────────────────────────────────────────────────────
WORKDIR /app/backend
COPY backend/main.py \
     backend/worker.py \
     backend/agent.py \
     backend/db_client.py \
     backend/whatsapp_client.py \
     backend/invoice_service.py \
     ./

# ── Next.js standalone build ──────────────────────────────────────────────────
# next build --output=standalone produces:
#   .next/standalone/   ← self-contained server (includes its own node_modules)
#   .next/static/       ← static assets (must be copied separately)
#   public/             ← public assets (must be copied separately)
WORKDIR /app/frontend
COPY --from=frontend-builder /app/frontend/.next/standalone ./
COPY --from=frontend-builder /app/frontend/.next/static     ./.next/static
COPY --from=frontend-builder /app/frontend/public           ./public

# ── nginx config ──────────────────────────────────────────────────────────────
COPY nginx.conf.template /etc/nginx/nginx.conf.template
RUN rm -f /etc/nginx/sites-enabled/default /etc/nginx/conf.d/default.conf

# ── supervisord config ────────────────────────────────────────────────────────
COPY supervisord.conf /etc/supervisord.conf

# ── entrypoint ────────────────────────────────────────────────────────────────
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Cloud Run expects the container to listen on $PORT (default 8080)
EXPOSE 8080

# supervisord manages nginx, uvicorn, and node — becomes PID 1
CMD ["/entrypoint.sh"]
