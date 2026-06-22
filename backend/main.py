"""
main.py — FastAPI application entrypoint.

Exposes:
  GET  /webhook  — Meta webhook verification challenge handler
  POST /webhook  — Inbound WhatsApp message ingress (fires BackgroundTask)
  GET  /health   — Basic health check

Security:
  All POST /webhook requests are validated against the X-Hub-Signature-256
  header using HMAC-SHA256 with the META_APP_SECRET. Requests without a
  valid signature are rejected with HTTP 401.
"""

import asyncio
import hashlib
import hmac
import os
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel
from dotenv import load_dotenv

import worker
import db_client
import whatsapp_client

load_dotenv()

INACTIVITY_MINUTES = 20   # Auto-resolve after this many minutes of silence
INACTIVITY_CHECK_INTERVAL = 60  # Check every N seconds

INACTIVITY_FAREWELL = (
    "\u23f0 We haven't heard from you in a while, so we're ending this session now. "
    "Thank you for chatting with us! "
    "Feel free to message us again anytime if you need further help. \U0001f60a"
)


async def _inactivity_resolver_loop() -> None:
    """
    Background task that runs every minute.
    Finds sessions idle for >20 min and auto-resolves them with a farewell message.
    """
    print(f"[inactivity] Auto-resolver started. Idle threshold: {INACTIVITY_MINUTES} min.")
    while True:
        await asyncio.sleep(INACTIVITY_CHECK_INTERVAL)
        try:
            stale = await db_client.get_stale_sessions(idle_minutes=INACTIVITY_MINUTES)
            if stale:
                print(f"[inactivity] Found {len(stale)} stale session(s) to resolve.")
            for session in stale:
                session_id = session["id"]
                phone = session["customer_phone"]
                try:
                    # Send farewell message
                    msg_id = await whatsapp_client.send_text_message(phone, INACTIVITY_FAREWELL)
                    if msg_id:
                        await db_client.insert_message(
                            message_id=msg_id,
                            session_id=session_id,
                            direction="outbound",
                            content_type="text",
                            text_content=INACTIVITY_FAREWELL,
                        )
                    await db_client.resolve_session(session_id)
                    print(f"[inactivity] Session {session_id} ({phone}) → RESOLVED (idle {INACTIVITY_MINUTES}+ min)")
                except Exception as e:
                    print(f"[inactivity] ERROR resolving session {session_id}: {e}")
        except Exception as e:
            print(f"[inactivity] Loop error: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Start background tasks on startup, clean up on shutdown."""
    task = asyncio.create_task(_inactivity_resolver_loop())
    yield
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        print("[inactivity] Auto-resolver stopped.")


VERIFY_TOKEN = os.environ.get("WEBHOOK_VERIFY_TOKEN", "")
META_APP_SECRET = os.environ.get("META_APP_SECRET", "")

app = FastAPI(title="Multi-Tenant WhatsApp Orchestrator", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Health Check
# ---------------------------------------------------------------------------

@app.get("/health")
async def health_check():
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Meta Webhook Verification (GET)
# ---------------------------------------------------------------------------

@app.get("/webhook")
async def verify_webhook(
    hub_mode: str = Query(None, alias="hub.mode"),
    hub_verify_token: str = Query(None, alias="hub.verify_token"),
    hub_challenge: str = Query(None, alias="hub.challenge"),
):
    """
    Meta sends a GET request to verify the webhook endpoint.
    We must return hub.challenge if the verify token matches.
    """
    if hub_mode == "subscribe" and hub_verify_token == VERIFY_TOKEN:
        return PlainTextResponse(content=hub_challenge, status_code=200)

    raise HTTPException(status_code=403, detail="Webhook verification failed.")


# ---------------------------------------------------------------------------
# Webhook Signature Validation
# ---------------------------------------------------------------------------

def _validate_signature(raw_body: bytes, signature_header: str | None) -> bool:
    """
    Validates the X-Hub-Signature-256 header sent by Meta.

    Meta computes: HMAC-SHA256(APP_SECRET, raw_request_body)
    We recompute the same hash and compare using hmac.compare_digest
    (constant-time comparison to prevent timing attacks).

    Returns True if the signature is valid, False otherwise.
    """
    if not META_APP_SECRET:
        # If the secret is not configured, skip validation (dev mode)
        print("[webhook] WARNING: META_APP_SECRET not set — skipping signature check.")
        return True

    if not signature_header or not signature_header.startswith("sha256="):
        print("[webhook] SECURITY: Missing or malformed X-Hub-Signature-256 header.")
        return False

    expected_sig = "sha256=" + hmac.new(
        META_APP_SECRET.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()

    is_valid = hmac.compare_digest(expected_sig, signature_header)
    if not is_valid:
        print(f"[webhook] SECURITY: Signature mismatch! Expected={expected_sig[:30]}..., Got={signature_header[:30]}...")
    return is_valid


# ---------------------------------------------------------------------------
# Inbound Message Handler (POST)
# ---------------------------------------------------------------------------

@app.post("/webhook")
async def receive_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Main webhook receiver.

    SECURITY: Validates X-Hub-Signature-256 before processing.

    CRITICAL — The "Status Update" Trap:
    Meta fires webhooks for every status change (sent, delivered, read).
    These payloads do NOT contain a 'messages' array. We must guard against
    this to prevent a KeyError crash when parsing the payload.

    Strategy:
    - Reject payloads with invalid signatures → HTTP 401.
    - If the payload is a status update → silently return 200 OK.
    - If it contains a real user message → parse, return 200 OK immediately,
      then hand off to the background worker (FastAPI BackgroundTasks).
    """
    # --- Step 1: Read raw bytes BEFORE parsing JSON (needed for signature check) ---
    raw_body = await request.body()

    # --- Step 2: Validate the HMAC-SHA256 signature ---
    signature_header = request.headers.get("X-Hub-Signature-256")
    if not _validate_signature(raw_body, signature_header):
        # Return 401 to signal rejection, but log it. Never return 4xx for
        # status updates — only for genuine security violations.
        raise HTTPException(status_code=401, detail="Invalid webhook signature.")

    # --- Step 3: Parse JSON from the already-read raw bytes ---
    import json
    payload = json.loads(raw_body)

    try:
        # Safely navigate the deeply nested Meta payload structure
        value = payload["entry"][0]["changes"][0]["value"]

        # --- Guard: Check if this is a status update, not a user message ---
        if "messages" not in value:
            if "statuses" in value:
                for status in value["statuses"]:
                    if status.get("status") == "failed":
                        print(f"[webhook] Message Delivery FAILED: {status}")
                        return {"status": "ok"}

            print(f"[webhook] Status update received — ignoring.")
            return {"status": "ok"}

        # --- It's a real user message — extract the data ---
        message_data = value["messages"][0]
        message_type: str = message_data.get("type", "text")

        # Only process text and image messages
        if message_type not in ("text", "image"):
            print(f"[webhook] Unsupported message type: {message_type} — ignoring.")
            return {"status": "ok"}

        message_id: str = message_data["id"]
        from_phone: str = message_data["from"]
        timestamp = datetime.fromtimestamp(
            int(message_data["timestamp"]), tz=timezone.utc
        )

        # Extract content depending on type
        if message_type == "text":
            text_body: str = message_data["text"]["body"]
            media_id: str | None = None
            print(f"[webhook] New text from {from_phone}: '{text_body}' (msg_id={message_id})")
        else:
            # Image message — text_body is the optional caption
            text_body = message_data.get("image", {}).get("caption", "")
            media_id = message_data.get("image", {}).get("id")
            print(f"[webhook] New image from {from_phone} (media_id={media_id}, caption='{text_body}')")

        # --- Dispatch to background worker — DO NOT AWAIT ---
        background_tasks.add_task(
            worker.process_inbound_message,
            message_id=message_id,
            from_phone=from_phone,
            text_body=text_body,
            timestamp=timestamp,
            message_type=message_type,
            media_id=media_id,
        )

    except (KeyError, IndexError, TypeError) as e:
        print(f"[webhook] Failed to parse payload: {e}. Payload: {payload}")

    # Always return 200 OK immediately to Meta
    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Broadcast Campaign API (POST)
# ---------------------------------------------------------------------------

class BroadcastRequest(BaseModel):
    tenant_id: str
    message: str
    phone_numbers: list[str]


@app.post("/api/broadcast")
async def trigger_broadcast(req: BroadcastRequest):
    """
    Broadcasts a custom message to a list of phone numbers.

    Uses a hybrid strategy:
    1. First attempts a free-form text message (works if the 24-hour window is open).
    2. Falls back to a Meta-approved template with a single body variable {{1}} if
       the window is closed.

    Prerequisites: Create a template called `custom_broadcast` (or whatever
    BROADCAST_TEMPLATE_NAME is set to) in Meta Business Manager with body = {{1}}.
    """
    import db_client
    import whatsapp_client

    tenant = await db_client.get_tenant_by_id(req.tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # Template name configured in .env — must be an approved Meta template with body {{1}}
    template_name = os.environ.get("BROADCAST_TEMPLATE_NAME", "custom_broadcast")

    results = {"success": [], "failed": []}

    for phone in req.phone_numbers:
        try:
            # 1. Try sending a normal free-form text message first.
            # This succeeds silently if the 24-hour customer service window is open!
            msg_id = await whatsapp_client.send_text_message(to_phone=phone, text=req.message)

            # 2. If it fails (e.g. window is closed), fallback to the approved template.
            if not msg_id:
                msg_id = await whatsapp_client.send_template_with_body_variable(
                    to_phone=phone,
                    template_name=template_name,
                    body_text=req.message,
                )

            if msg_id:
                session_id = f"broadcast_{req.tenant_id}_{phone}"
                await db_client.insert_message(
                    message_id=msg_id,
                    session_id=session_id,
                    direction="outbound",
                    content_type="text",
                    text_content=req.message,
                )
                results["success"].append(phone)
            else:
                results["failed"].append(phone)
        except Exception as e:
            print(f"[broadcast] Error sending to {phone}: {e}")
            results["failed"].append(phone)

    return {"status": "completed", "results": results}



# ---------------------------------------------------------------------------
# Human Chat API
# ---------------------------------------------------------------------------

class ChatRequest(BaseModel):
    session_id: str
    customer_phone: str
    text: str
    override: bool = False


class SessionReadRequest(BaseModel):
    customer_phone: str


@app.post("/api/sessions/{session_id}/read")
async def mark_session_read(session_id: str, body: SessionReadRequest):
    """
    Send a WhatsApp read receipt for the last inbound message in this session.
    Called by the dashboard the moment a human agent opens/selects a chat.
    This produces the blue double-ticks on the customer's side.
    Only meaningful for NEEDS_HUMAN sessions — bot sessions handle their own receipts.
    """
    last_wamid = await db_client.get_last_inbound_message_id(session_id)
    if last_wamid:
        await whatsapp_client.mark_message_read(last_wamid)
        print(f"[api:read] Blue ticks sent for session {session_id} (wamid={last_wamid})")
        return {"status": "read_receipt_sent", "message_id": last_wamid}
    return {"status": "no_inbound_messages"}


@app.post("/api/messages/send")
async def send_human_message(req: ChatRequest):
    """
    Sends a message from a human agent to the WhatsApp user.
    - If override=True: also sets session to NEEDS_HUMAN to halt bot replies.
    - Fires a typing indicator (via mark_message_read) before sending so the
      customer sees a "typing…" bubble for ~1.5 seconds first.
    """
    if req.override:
        await db_client.update_session_status(req.session_id, "NEEDS_HUMAN")
        print(f"[api:chat] Session {req.session_id} overridden by human.")

    # Typing indicator: reuse mark_message_read which triggers the bubble
    last_wamid = await db_client.get_last_inbound_message_id(req.session_id)
    if last_wamid:
        await whatsapp_client.mark_message_read(last_wamid)
        await asyncio.sleep(1.5)   # Let the typing bubble be visible before message arrives

    msg_id = await whatsapp_client.send_text_message(req.customer_phone, req.text)
    if msg_id:
        await db_client.insert_message(
            message_id=msg_id,
            session_id=req.session_id,
            direction="outbound",
            content_type="text",
            text_content=req.text,
        )
        return {"status": "success", "message_id": msg_id}
    else:
        raise HTTPException(status_code=500, detail="Failed to send message via Meta API")


# ---------------------------------------------------------------------------
# Appointments API
# ---------------------------------------------------------------------------

from supabase import create_client as _create_sb_sync

def _sync_supabase():
    return _create_sb_sync(
        os.environ["SUPABASE_URL"],
        os.environ["SUPABASE_SECRET_KEY"],
    )


@app.get("/api/appointments")
async def list_appointments(tenant_id: str, status: str | None = None):
    """
    Returns all appointments for a given tenant.
    Optional `status` query param filters by: SCHEDULED | INVOICED | CANCELLED
    """
    sb = _sync_supabase()
    query = sb.table("appointments").select("*").eq("tenant_id", tenant_id).order("created_at", desc=True)
    if status:
        query = query.eq("status", status)
    result = query.execute()
    return {"appointments": result.data}


class CancelAppointmentRequest(BaseModel):
    reason: str = "Cancelled by staff"


@app.post("/api/appointments/{appointment_id}/cancel")
async def cancel_appointment(appointment_id: str, req: CancelAppointmentRequest):
    """Cancel an appointment and notify the customer via WhatsApp."""
    sb = _sync_supabase()

    # Fetch appointment to get customer phone
    appt_result = sb.table("appointments").select("*").eq("id", appointment_id).single().execute()
    if not appt_result.data:
        raise HTTPException(status_code=404, detail="Appointment not found")

    appt = appt_result.data

    # Mark as cancelled
    sb.table("appointments").update({"status": "CANCELLED"}).eq("id", appointment_id).execute()

    # Notify the customer on WhatsApp
    msg = (
        f"Hi {appt.get('customer_name', 'there')}, your appointment scheduled for "
        f"{appt.get('appointment_date', '')} at {appt.get('appointment_time', '')} "
        f"has been cancelled. Reason: {req.reason}. "
        f"Please contact us to reschedule. We apologise for the inconvenience. 🙏"
    )
    await whatsapp_client.send_text_message(appt["customer_phone"], msg)

    return {"status": "cancelled", "appointment_id": appointment_id}


class RegenerateInvoiceRequest(BaseModel):
    pass


@app.post("/api/appointments/{appointment_id}/generate-invoice")
async def regenerate_invoice(appointment_id: str):
    """
    Manually generate (or re-generate) a PDF invoice for an appointment.
    Useful for re-sending or manual triggering from the dashboard.
    """
    import invoice_service

    api_key = os.environ.get("INVOICE_GENERATOR_API_KEY", "")
    if not api_key:
        raise HTTPException(status_code=500, detail="INVOICE_GENERATOR_API_KEY not configured")

    sb = _sync_supabase()
    appt_result = sb.table("appointments").select("*").eq("id", appointment_id).single().execute()
    if not appt_result.data:
        raise HTTPException(status_code=404, detail="Appointment not found")

    appt = appt_result.data
    services = appt.get("services", [])

    if not services:
        raise HTTPException(status_code=400, detail="No services on this appointment")

    import time
    invoice_number = str(int(time.time()))[-8:]

    pdf_bytes = await invoice_service.generate_invoice_pdf(
        api_key=api_key,
        from_address="Automotive Care\nKrid Services Pvt. Ltd.",
        to_name=appt.get("customer_name", "Customer"),
        customer_phone=appt["customer_phone"],
        services=services,
        appointment_date=appt.get("appointment_date", ""),
        invoice_number=invoice_number,
        currency="INR",
    )

    if not pdf_bytes:
        raise HTTPException(status_code=500, detail="Invoice generation failed")

    invoice_url = await invoice_service.upload_pdf_to_storage(
        pdf_bytes=pdf_bytes,
        tenant_id=appt["tenant_id"],
        invoice_number=invoice_number,
    )

    if not invoice_url:
        raise HTTPException(status_code=500, detail="Failed to upload invoice to storage")

    # Update appointment
    sb.table("appointments").update(
        {"status": "INVOICED", "invoice_url": invoice_url}
    ).eq("id", appointment_id).execute()

    # Send to customer on WhatsApp
    out_id = await whatsapp_client.send_document_message(
        appt["customer_phone"],
        doc_url=invoice_url,
        filename=f"Invoice_{invoice_number}.pdf",
        caption="📄 Here is your updated service invoice.",
    )

    return {"status": "invoice_sent", "invoice_url": invoice_url, "message_id": out_id}