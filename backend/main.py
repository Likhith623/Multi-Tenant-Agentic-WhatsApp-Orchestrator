"""
main.py — FastAPI application entrypoint.

Exposes:
  GET  /webhook  — Meta webhook verification challenge handler
  POST /webhook  — Inbound WhatsApp message ingress (fires BackgroundTask)
  GET  /health   — Basic health check
"""

import os
from datetime import datetime, timezone

from fastapi import BackgroundTasks, FastAPI, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse
from dotenv import load_dotenv

import worker

load_dotenv()

app = FastAPI(title="Multi-Tenant WhatsApp Orchestrator")

VERIFY_TOKEN = os.environ.get("WEBHOOK_VERIFY_TOKEN", "")


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
# Inbound Message Handler (POST)
# ---------------------------------------------------------------------------

@app.post("/webhook")
async def receive_webhook(request: Request, background_tasks: BackgroundTasks):
    """
    Main webhook receiver.

    CRITICAL — The "Status Update" Trap:
    Meta fires webhooks for every status change (sent, delivered, read).
    These payloads do NOT contain a 'messages' array. We must guard against
    this to prevent a KeyError crash when parsing the payload.

    Strategy:
    - If the payload is a status update → silently return 200 OK.
    - If it contains a real user message → parse, return 200 OK immediately,
      then hand off to the background worker (FastAPI BackgroundTasks).
    """
    payload = await request.json()

    try:
        # Safely navigate the deeply nested Meta payload structure
        value = payload["entry"][0]["changes"][0]["value"]

        # --- Guard: Check if this is a status update, not a user message ---
        if "messages" not in value:
            # This is a status update (sent/delivered/read notification).
            # Log it and return immediately — do NOT crash.
            print(f"[webhook] Status update received — ignoring.")
            return {"status": "ok"}

        # --- It's a real user message — extract the data ---
        message_data = value["messages"][0]
        phone_number_id = value["metadata"]["phone_number_id"]

        # Only process text messages for now (Phase 3 adds media handling)
        if message_data.get("type") != "text":
            print(f"[webhook] Non-text message type received: {message_data.get('type')} — ignoring.")
            return {"status": "ok"}

        message_id: str = message_data["id"]
        from_phone: str = message_data["from"]
        text_body: str = message_data["text"]["body"]
        # Meta sends timestamp as a Unix epoch string
        timestamp = datetime.fromtimestamp(
            int(message_data["timestamp"]), tz=timezone.utc
        )

        print(
            f"[webhook] New message from {from_phone}: '{text_body}' "
            f"(msg_id={message_id})"
        )

        # --- Dispatch to background worker — DO NOT AWAIT ---
        # FastAPI's BackgroundTasks runs after the HTTP response is returned,
        # satisfying Meta's 3-second timeout requirement.
        background_tasks.add_task(
            worker.process_inbound_message,
            message_id=message_id,
            from_phone=from_phone,
            text_body=text_body,
            timestamp=timestamp,
        )

    except (KeyError, IndexError, TypeError) as e:
        # Malformed or unexpected payload shape — log and return 200 OK
        # (Never return 4xx to Meta, or it will keep retrying)
        print(f"[webhook] Failed to parse payload: {e}. Payload: {payload}")

    # Always return 200 OK immediately to Meta
    return {"status": "ok"}