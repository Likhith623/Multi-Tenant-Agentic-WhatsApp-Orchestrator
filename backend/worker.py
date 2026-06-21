"""
worker.py — Async background task executed by FastAPI BackgroundTasks.

Responsibilities (pre-flight only):
  1. Get or create the customer session.
  2. Routing Menu — handle tenant selection for new users.
  3. Concurrency guard — drop duplicate triggers when AGENT_RESPONDING.
  4. Hand off to the 4-node LangGraph agent (agent.py).

NOTE: All acknowledgement (read receipt, typing indicator, DB logging, and
session locking) now happens inside the LangGraph Acknowledge Node, keeping
the graph the single source of truth for the processing pipeline.

A safety finally block is kept here as a last-resort crash guard to ensure
the session is never permanently stuck in AGENT_RESPONDING.
"""

from datetime import datetime, timezone

import agent
import db_client
import whatsapp_client

TENANT_MENU_MESSAGE = (
    "👋 Welcome! Please choose a service:\n\n"
    "*1️⃣* — Luxury Furniture Support\n"
    "*2️⃣* — Automotive Care\n\n"
    "Simply reply with *1* or *2*."
)

TENANT_SELECTION_MAP = {
    "1": "Luxury Furniture Store",
    "2": "Automotive Care",
}


async def process_inbound_message(
    message_id: str,
    from_phone: str,
    text_body: str,
    timestamp: datetime,
) -> None:
    """
    Main background worker. Called by the FastAPI POST /webhook route.
    All heavy lifting happens here, safely outside the 3-second HTTP window.
    """

    # -------------------------------------------------------------------------
    # Step 1: Get or create session for this phone number
    # -------------------------------------------------------------------------
    session = await db_client.get_session_by_phone(from_phone)

    if session is None:
        session = await db_client.create_session(from_phone)

    session_id = session["id"]

    # -------------------------------------------------------------------------
    # Step 2: Routing Menu — guide the user to select a tenant
    # The LangGraph agent only runs AFTER a tenant has been assigned.
    # -------------------------------------------------------------------------
    tenant_id = session.get("tenant_id")

    if tenant_id is None:
        # First, log this inbound message before responding to the menu
        await db_client.insert_message(
            message_id=message_id,
            session_id=session_id,
            direction="inbound",
            content_type="text",
            text_content=text_body,
            timestamp=timestamp,
        )

        user_choice = text_body.strip()

        if user_choice not in ("1", "2"):
            # Unknown input — show the routing menu again
            out_msg_id = await whatsapp_client.send_text_message(
                from_phone, TENANT_MENU_MESSAGE
            )
            if out_msg_id:
                await db_client.insert_message(
                    message_id=out_msg_id,
                    session_id=session_id,
                    direction="outbound",
                    content_type="text",
                    text_content=TENANT_MENU_MESSAGE,
                )
            return

        # Valid selection — resolve the tenant from the database
        all_tenants = await db_client.get_all_tenants()
        tenant_name_target = TENANT_SELECTION_MAP[user_choice]
        matched_tenant = next(
            (t for t in all_tenants if t["name"] == tenant_name_target), None
        )

        if matched_tenant is None:
            # Safety net — tenant not found in DB (should not happen after seeding)
            await whatsapp_client.send_text_message(
                from_phone, "Sorry, something went wrong. Please try again later."
            )
            return

        await db_client.set_session_tenant(session_id, matched_tenant["id"])
        tenant_id = matched_tenant["id"]

        confirm_text = f"✅ Great! You're now connected to *{matched_tenant['name']}* support. How can I help you today?"
        out_msg_id = await whatsapp_client.send_text_message(from_phone, confirm_text)
        if out_msg_id:
            await db_client.insert_message(
                message_id=out_msg_id,
                session_id=session_id,
                direction="outbound",
                content_type="text",
                text_content=confirm_text,
            )
        return  # Next message will enter the full 4-node LangGraph pipeline

    # -------------------------------------------------------------------------
    # Step 3: Concurrency guard — prevent duplicate processing from double-texts
    # -------------------------------------------------------------------------
    current_status = session.get("status")

    if current_status == "AGENT_RESPONDING":
        # Another LangGraph run is already in progress for this session.
        # Drop this trigger — the ongoing run will finish first.
        print(
            f"[worker] Session {session_id} is AGENT_RESPONDING. "
            f"Dropping duplicate trigger for message {message_id}."
        )
        return

    # -------------------------------------------------------------------------
    # Step 4: Hand off to the 4-node LangGraph agent
    #
    # The agent handles (in order):
    #   Node 1 (Acknowledge)      → read receipt + typing ON + log inbound msg + lock session
    #   Node 2 (Context Retriever)→ fetch tenant prompt + media library + chat history
    #   Node 3 (LLM Reasoning)    → mistral-small-2506 decides text or tool call
    #   Node 4 (Dispatcher)       → send reply + log outbound msg + typing OFF + unlock session
    # -------------------------------------------------------------------------
    try:
        await agent.run(
            session_id=session_id,
            tenant_id=tenant_id,
            from_phone=from_phone,
            inbound_text=text_body,
            message_id=message_id,
            timestamp=timestamp,
        )

    except Exception as e:
        # -------------------------------------------------------------------------
        # Safety net: If the graph crashes before the Dispatcher Node's finally
        # block runs, ensure we still turn off typing and unlock the session.
        # -------------------------------------------------------------------------
        print(f"[worker] CRITICAL ERROR in LangGraph for session {session_id}: {e}")
        await whatsapp_client.toggle_typing_indicator(from_phone, on=False)
        await db_client.update_session_status(session_id, "WAITING_FOR_BOT")
        raise
