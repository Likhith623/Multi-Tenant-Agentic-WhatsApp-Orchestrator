-- Supabase PostgreSQL Schema Migration

-- Enable pgcrypto for UUID generation if not exists
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Tenants Table
CREATE TABLE tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    prompt_directions TEXT NOT NULL,
    media_library JSONB NOT NULL DEFAULT '{}'::jsonb
);

-- Sessions Table (Concurrency Control & Routing)
CREATE TABLE sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_phone TEXT UNIQUE NOT NULL,
    tenant_id UUID REFERENCES tenants(id), -- Nullable initially
    status TEXT NOT NULL DEFAULT 'WAITING_FOR_BOT', -- WAITING_FOR_BOT, AGENT_RESPONDING, RESOLVED
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Messages Table (Audit Log)
CREATE TABLE messages (
    id TEXT PRIMARY KEY, -- Meta Message ID
    session_id UUID NOT NULL REFERENCES sessions(id),
    direction TEXT NOT NULL, -- 'inbound' or 'outbound'
    timestamp TIMESTAMPTZ NOT NULL,
    content_type TEXT NOT NULL, -- 'text', 'image', 'document'
    text_content TEXT,
    media_url TEXT
);

-- Performance Optimization: Compound Index for Context Retriever
CREATE INDEX idx_messages_session_timestamp ON messages (session_id, timestamp DESC);
