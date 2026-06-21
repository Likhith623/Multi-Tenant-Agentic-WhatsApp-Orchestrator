import os
from supabase import create_client, Client
from dotenv import load_dotenv
from datetime import datetime, timezone

load_dotenv()

_supabase: Client = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SECRET_KEY"],
)


# ---------------------------------------------------------------------------
# Session helpers
# ---------------------------------------------------------------------------

async def get_session_by_phone(phone: str) -> dict | None:
    """Return the session row for a given customer phone, or None."""
    res = (
        _supabase.table("sessions")
        .select("*")
        .eq("customer_phone", phone)
        .maybe_single()
        .execute()
    )
    return res.data if res else None


async def create_session(phone: str) -> dict:
    """Insert a new session (tenant_id is null until the user picks one)."""
    res = (
        _supabase.table("sessions")
        .insert({"customer_phone": phone, "status": "WAITING_FOR_BOT"})
        .execute()
    )
    return res.data[0]


async def set_session_tenant(session_id: str, tenant_id: str) -> None:
    """Assign a tenant to an existing session after menu selection."""
    _supabase.table("sessions").update(
        {"tenant_id": tenant_id, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", session_id).execute()


async def update_session_status(session_id: str, status: str) -> None:
    """
    Update the session status field.
    Used as a database lock:
      - 'AGENT_RESPONDING' → locks the session (no new runs allowed)
      - 'WAITING_FOR_BOT'  → unlocks the session
    """
    _supabase.table("sessions").update(
        {"status": status, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", session_id).execute()


# ---------------------------------------------------------------------------
# Message helpers
# ---------------------------------------------------------------------------

async def insert_message(
    *,
    message_id: str,
    session_id: str,
    direction: str,          # 'inbound' or 'outbound'
    content_type: str,       # 'text', 'image', 'document'
    text_content: str | None = None,
    media_url: str | None = None,
    timestamp: datetime | None = None,
) -> dict:
    """
    Insert a parsed message record into the audit log.
    Accepts clean, pre-parsed fields — NOT the raw Meta payload.
    """
    ts = (timestamp or datetime.now(timezone.utc)).isoformat()
    res = (
        _supabase.table("messages")
        .insert(
            {
                "id": message_id,
                "session_id": session_id,
                "direction": direction,
                "timestamp": ts,
                "content_type": content_type,
                "text_content": text_content,
                "media_url": media_url,
            }
        )
        .execute()
    )
    return res.data[0]


async def get_last_n_messages(session_id: str, n: int = 5) -> list[dict]:
    """
    Fetch the last N messages for a session ordered by timestamp DESC.
    Uses the compound index (session_id, timestamp DESC) for fast retrieval.
    """
    res = (
        _supabase.table("messages")
        .select("*")
        .eq("session_id", session_id)
        .order("timestamp", desc=True)
        .limit(n)
        .execute()
    )
    # Reverse so the list is chronological (oldest → newest)
    return list(reversed(res.data))


# ---------------------------------------------------------------------------
# Tenant helpers
# ---------------------------------------------------------------------------

async def get_tenant_by_id(tenant_id: str) -> dict | None:
    """Fetch a full tenant record including media_library and prompt_directions."""
    res = (
        _supabase.table("tenants")
        .select("*")
        .eq("id", tenant_id)
        .maybe_single()
        .execute()
    )
    return res.data if res else None


async def get_all_tenants() -> list[dict]:
    """Fetch all tenants — used by the frontend dashboard tenant switcher."""
    res = _supabase.table("tenants").select("id, name").execute()
    return res.data
