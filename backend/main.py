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

import hashlib
import hmac
import os
from datetime import datetime, timezone

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from dotenv import load_dotenv

import worker

load_dotenv()

app = FastAPI(title="Multi-Tenant WhatsApp Orchestrator")

VERIFY_TOKEN = os.environ.get("WEBHOOK_VERIFY_TOKEN", "")
META_APP_SECRET = os.environ.get("META_APP_SECRET", "")


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