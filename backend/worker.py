"""
worker.py — Async background task executed by FastAPI BackgroundTasks.

Flow:
  1. Log the inbound message to the database.
  2. Check if session needs a tenant selection (Routing Menu).
  3. Check for concurrency lock (AGENT_RESPONDING = double-text guard).
  4. Lock session → fire typing indicator → call LangGraph (Phase 3 placeholder).
  5. Unlock session after response is dispatched.
"""

import uuid
from datetime import datetime, timezone

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
    # Step 1: Immediately send a read receipt so the user sees double blue ticks
    # -------------------------------------------------------------------------
    await whatsapp_client.mark_message_read(message_id)

    # -------------------------------------------------------------------------
    # Step 2: Get or create session for this phone number
    # -------------------------------------------------------------------------
    session = await db_client.get_session_by_phone(from_phone)

    if session is None:
        session = await db_client.create_session(from_phone)

    session_id = session["id"]

    # -------------------------------------------------------------------------
    # Step 3: Log the inbound message to the audit trail
    # -------------------------------------------------------------------------
    await db_client.insert_message(
        message_id=message_id,
        session_id=session_id,
        direction="inbound",
        content_type="text",
        text_content=text_body,
        timestamp=timestamp,
    )

    # -------------------------------------------------------------------------
    # Step 4: Routing Menu — guide the user to select a tenant
    # -------------------------------------------------------------------------
    tenant_id = session.get("tenant_id")

    if tenant_id is None:
        # The user has not yet picked a tenant
        user_choice = text_body.strip()

        if user_choice not in ("1", "2"):
            # Unknown input — show the menu again
            out_msg_id = await whatsapp_client.send_text_message(
                from_phone, TENANT_MENU_MESSAGE
            )
            # Log the outbound menu message
            if out_msg_id:
                await db_client.insert_message(
                    message_id=out_msg_id,
                    session_id=session_id,
                    direction="outbound",
                    content_type="text",
                    text_content=TENANT_MENU_MESSAGE,
                )
            return

        # Valid selection — resolve tenant_id from the database
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

        confirm_text = f"✅ Great! You're connected to *{matched_tenant['name']}* support. How can I help you today?"
        out_msg_id = await whatsapp_client.send_text_message(from_phone, confirm_text)
        if out_msg_id:
            await db_client.insert_message(
                message_id=out_msg_id,
                session_id=session_id,
                direction="outbound",
                content_type="text",
                text_content=confirm_text,
            )
        return  # Next message will be handled by LangGraph in Phase 3

    # -------------------------------------------------------------------------
    # Step 5: Concurrency guard — prevent duplicate processing from double-texts
    # -------------------------------------------------------------------------
    current_status = session.get("status")

    if current_status == "AGENT_RESPONDING":
        # Another LangGraph run is already in progress for this session.
        # Simply append this message to history and exit — the ongoing run
        # will finish before the next message can trigger a new one.
        print(
            f"[worker] Session {session_id} is AGENT_RESPONDING. "
            f"Dropping duplicate trigger for message {message_id}."
        )
        return

    # -------------------------------------------------------------------------
    # Step 6: Lock the session and fire typing indicator
    # -------------------------------------------------------------------------
    await db_client.update_session_status(session_id, "AGENT_RESPONDING")

    # Fire typing indicator immediately AFTER locking so the user sees
    # the "typing..." bubble during the entire LLM processing window.
    await whatsapp_client.toggle_typing_indicator(from_phone, on=True)

    try:
        # ---------------------------------------------------------------------
        # Step 7: LangGraph Agent — PLACEHOLDER (implemented in Phase 3)
        # ---------------------------------------------------------------------
        # In Phase 3, this will be replaced with:
        #   await langgraph_agent.run(session_id, tenant_id, from_phone, text_body)
        #
        # For now, send a placeholder reply to verify the full pipeline works.
        placeholder_text = (
            "🤖 _(Agent placeholder — LangGraph will take over in Phase 3)_\n\n"
            f"I received your message: _{text_body}_"
        )
        out_msg_id = await whatsapp_client.send_text_message(from_phone, placeholder_text)
        if out_msg_id:
            await db_client.insert_message(
                message_id=out_msg_id,
                session_id=session_id,
                direction="outbound",
                content_type="text",
                text_content=placeholder_text,
            )

    finally:
        # ---------------------------------------------------------------------
        # Step 8: Always unlock the session — even if the LLM call crashes
        # ---------------------------------------------------------------------
        await whatsapp_client.toggle_typing_indicator(from_phone, on=False)
        await db_client.update_session_status(session_id, "WAITING_FOR_BOT")
