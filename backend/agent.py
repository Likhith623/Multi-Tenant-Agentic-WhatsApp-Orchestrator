"""
agent.py — LangGraph AI Orchestration Pipeline (4-Node Architecture)

Exactly matches the assignment's Task 3 diagram:

  [Webhook Inbound]
        |
        v
  ┌─────────────────────┐
  │  Acknowledge Node   │──► Send Read Receipt + Typing ON + Save Inbound Msg to DB
  └─────────────────────┘     (If image: download media bytes for multimodal analysis)
        |
        v
  ┌─────────────────────────┐
  │  Context Retriever Node │──► Pull tenant rules & last 5 messages from DB
  └─────────────────────────┘
        |
        v
  ┌─────────────────────┐
  │  LLM Reasoning Node │──► Gemini 1.5 Pro (multimodal) decides response type
  └─────────────────────┘     Analyses sentiment → can trigger escalate_to_human
        |
        v
  ┌──────────────────┐
  │  Dispatcher Node │──► Send Text/Image/Doc/Escalation + Save State + Typing OFF
  └──────────────────┘

State flows as a TypedDict, accumulating data across all 4 nodes.

LLM: Google Gemini 1.5 Pro via langchain-google-genai
  - Supports native multimodal (text + image) inputs
  - Tool calling for attach_media and escalate_to_human
"""

import base64
import os
from typing import TypedDict, Any
from datetime import datetime, timezone

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, BaseMessage
from langchain_core.tools import tool
from langchain_mistralai import ChatMistralAI
from langchain_google_genai import ChatGoogleGenerativeAI
from langgraph.graph import StateGraph, END

import db_client
import whatsapp_client
import invoice_service

load_dotenv()


# ---------------------------------------------------------------------------
# LLM Setup
# ---------------------------------------------------------------------------

# Primary LLM: Mistral Small — handles all conversational reasoning & tool calls
_llm = ChatMistralAI(
    model="mistral-small-2506",
    api_key=os.environ["MISTRAL_API_KEY"],
    temperature=0.4,
)

# Vision Preprocessor: Gemini 2.0 Flash Lite — converts inbound images into
# a rich text description that is then fed into Mistral as context.
# This keeps Mistral as the single reasoning engine while gaining vision.
_vision_llm = ChatGoogleGenerativeAI(
    model="gemini-3.1-flash-lite",
    google_api_key=os.environ["GEMINI_API_KEY"],
    temperature=0.2,  # Low temp for factual image description
    convert_system_message_to_human=True,
)


# ---------------------------------------------------------------------------
# Tool Definitions
# ---------------------------------------------------------------------------

@tool
def attach_media(keyword: str) -> str:
    """
    Send a media file to the user on WhatsApp (image, PDF, or document).

    Use this tool whenever the user asks for any file, image, or document
    that appears in the AVAILABLE MEDIA ASSETS list in the system prompt.
    Pass the exact keyword string from that list.
    Never say you cannot send files — use this tool instead.
    """
    return keyword


@tool
def escalate_to_human(reason: str) -> str:
    """
    Use this tool ONLY when the user expresses clear frustration, anger,
    or explicitly requests to speak with a human agent. This will halt all
    automated replies and flag the conversation for immediate human review.

    Args:
        reason: A brief summary of why the conversation is being escalated
                (e.g., "User is frustrated about delivery delay").
    """
    return reason


@tool
def close_conversation(farewell_message: str) -> str:
    """
    Gracefully close this conversation and mark the session as RESOLVED.

    Use this tool when the user clearly signals they are done, for example:
    - "Thank you", "Thanks", "Thanks for your help"
    - "Goodbye", "Bye", "See you", "That's all"
    - "I'm good", "Got it, thanks", "All done"
    - Any clear conversational farewell or sign-off

    The farewell_message you provide will be sent to the user before the
    session is closed. Keep it warm, brief, and friendly.

    After calling this tool the session is RESOLVED. The customer can start
    a fresh conversation at any time by sending a new message.

    Args:
        farewell_message: The goodbye message to send to the user.
    """
    return farewell_message


@tool
def book_appointment(
    customer_name: str,
    vehicle_info: str,
    services: str,
    appointment_date: str,
    appointment_time: str,
    notes: str = "",
) -> str:
    """
    Book a service appointment for the customer.

    Call this ONLY once you have collected ALL of the following from the
    customer through conversation:
      - customer_name: their full name
      - vehicle_info: make, model, and year of their vehicle (e.g. "Honda City 2020")
      - services: comma-separated list of services they need
                  (e.g. "Oil Change, Brake Pad Replacement").
                  Each service MUST include the price from the pricing catalog
                  in this format: "ServiceName:price" (e.g. "Oil Change:2500")
      - appointment_date: the date they prefer (e.g. "June 25, 2025")
      - appointment_time: the time they prefer (e.g. "10:00 AM")
      - notes: any extra notes (optional)

    Returns a booking reference string once saved successfully.
    After calling this, ALWAYS call generate_and_send_invoice next.
    """
    return f"BOOK:{customer_name}|{vehicle_info}|{services}|{appointment_date}|{appointment_time}|{notes}"


@tool
def generate_and_send_invoice(
    booking_ref: str,
    customer_name: str,
) -> str:
    """
    Generate a professional PDF invoice and send it to the customer on WhatsApp.

    Call this IMMEDIATELY after book_appointment succeeds.
    Pass the exact booking_ref string returned by book_appointment, and
    the customer's name for personalisation.

    This will:
      1. Generate a PDF invoice via invoice-generator.com
      2. Upload it to cloud storage
      3. Send it as a WhatsApp document to the customer
    """
    return f"INVOICE:{booking_ref}|{customer_name}"


_tools = [attach_media, escalate_to_human, close_conversation, book_appointment, generate_and_send_invoice]
_llm_with_tools = _llm.bind_tools(_tools)


# ---------------------------------------------------------------------------
# Graph State
# ---------------------------------------------------------------------------

class AgentState(TypedDict):
    # --- Inputs provided by worker.py ---
    session_id: str
    tenant_id: str
    from_phone: str
    inbound_text: str
    message_id: str           # Original WhatsApp message ID (for read receipt)
    timestamp: datetime       # Inbound message timestamp (for DB audit log)
    message_type: str         # "text" or "image"
    media_id: str | None      # WhatsApp Media ID (for image messages)

    # --- Populated by: Acknowledge Node ---
    inbound_image_b64: str | None  # Base64-encoded image bytes (if image message)

    # --- Populated by: Context Retriever Node ---
    tenant_name: str
    tenant_prompt: str
    media_library: list | dict   # list [{id,name,url,type,...}] or legacy dict {"name": "url"}
    chat_history: list[BaseMessage] # LangChain message objects (last 5 msgs)

    # --- Populated by: LLM Reasoning Node ---
    ai_message: AIMessage | None


# ---------------------------------------------------------------------------
# Node 1: Acknowledge Node
# ---------------------------------------------------------------------------

async def acknowledge_node(state: AgentState) -> AgentState:
    """
    Immediately acknowledges the inbound message by:
      1. Sending a read receipt → user sees double blue ticks.
      2. Turning on the typing indicator → user sees 'typing...' bubble.
      3. Saving the inbound message to the database.
      4. Locking the session (status = AGENT_RESPONDING).
      5. [If image] Downloading and base64-encoding the image for Gemini.
    """
    print(f"[agent:acknowledge] Processing message {state['message_id']} from {state['from_phone']}")

    # 1. Send read receipt (double blue ticks)
    await whatsapp_client.mark_message_read(state["message_id"])

    # 2. Fire typing indicator — user sees 'typing...' immediately
    await whatsapp_client.toggle_typing_indicator(state["from_phone"], on=True)

    # 3. Save the inbound message to the database
    await db_client.insert_message(
        message_id=state["message_id"],
        session_id=state["session_id"],
        direction="inbound",
        content_type=state["message_type"],
        text_content=state["inbound_text"] or f"[{state['message_type']} message]",
        timestamp=state["timestamp"],
    )

    # 4. Lock the session to prevent concurrent double-text processing
    await db_client.update_session_status(state["session_id"], "AGENT_RESPONDING")

    # 5. If this is an image message, download and base64-encode for Gemini
    inbound_image_b64: str | None = None
    if state["message_type"] == "image" and state["media_id"]:
        print(f"[agent:acknowledge] Downloading image media_id={state['media_id']}")
        image_bytes = await whatsapp_client.download_media(state["media_id"])
        if image_bytes:
            inbound_image_b64 = base64.b64encode(image_bytes).decode("utf-8")
            print(f"[agent:acknowledge] Image downloaded: {len(image_bytes)} bytes → base64 encoded")
        else:
            print(f"[agent:acknowledge] WARNING: Could not download image media_id={state['media_id']}")

    return {**state, "inbound_image_b64": inbound_image_b64}


# ---------------------------------------------------------------------------
# Node 2: Context Retriever Node
# ---------------------------------------------------------------------------

async def context_retriever_node(state: AgentState) -> AgentState:
    """
    Pulls the Tenant's prompt, media catalog rules, and the last 5 messages
    of chat history from the database.
    Formats history into LangChain message objects for the LLM.
    """
    # Fetch full tenant record (persona prompt + media library)
    tenant = await db_client.get_tenant_by_id(state["tenant_id"])

    if tenant is None:
        raise ValueError(f"[agent:context_retriever] Tenant {state['tenant_id']} not found.")

    # 8 messages is sufficient for all tenants:
    # - Automotive: the new compact booking flow takes just 2-4 turns
    #   (1 message collects name/vehicle/date/time, 1 message picks services).
    # - Other tenants: 8 msgs gives solid Q&A context without bloating the prompt.
    raw_messages = await db_client.get_last_n_messages(state["session_id"], n=10)

    # Convert to LangChain message objects (chronological order)
    chat_history: list[BaseMessage] = []
    for msg in raw_messages:
        text = msg.get("text_content") or ""
        if msg["direction"] == "inbound":
            chat_history.append(HumanMessage(content=text))
        else:
            chat_history.append(AIMessage(content=text))

    print(f"[agent:context_retriever] Tenant='{tenant['name']}' | History={len(chat_history)} msgs")

    return {
        **state,
        "tenant_name": tenant["name"],
        "tenant_prompt": tenant["prompt_directions"],
        "media_library": tenant.get("media_library", {}),
        "chat_history": chat_history,
    }


# ---------------------------------------------------------------------------
# Node 3: LLM Reasoning Node (Gemini Multimodal)
# ---------------------------------------------------------------------------

async def llm_reasoning_node(state: AgentState) -> AgentState:
    """
    Invokes Google Gemini 1.5 Pro to determine the next conversational step.

    Agentic Decision-Making:
      The LLM decides whether to:
        (a) Reply with a plain text string.
        (b) Trigger the attach_media tool to send a document/image asset.
        (c) Trigger the escalate_to_human tool if the user is frustrated.

    Multimodal Input:
      If the inbound message is an image, it is passed as a base64-encoded
      image_url block in the HumanMessage content alongside the caption text.
      Gemini natively processes this to describe the image in the context of
      the tenant's business.
    """
    # Normalise media_library regardless of storage format:
    #   New format (from frontend): list of {id, name, url, type, ...}
    #   Legacy format: dict {"keyword": "url"}
    # Keys are lowercased so the LLM's keyword (also lowercased) always matches,
    # regardless of how the user capitalised the name in the Media Library UI.
    raw_library = state["media_library"] or []
    if isinstance(raw_library, list):
        media_library: dict[str, str] = {
            item["name"].lower().strip(): item["url"]
            for item in raw_library
            if item.get("name") and item.get("url")
        }
    else:
        media_library: dict[str, str] = {
            k.lower().strip(): v for k, v in raw_library.items()
        }
    media_keywords = list(media_library.keys())

    # Build the media section separately to avoid f-string nesting issues
    if media_keywords:
        media_lines = "\n".join(f'  - keyword: "{kw}"' for kw in media_keywords)
        media_section = (
            "AVAILABLE MEDIA ASSETS:\n"
            "The following files are available to send to the user. "
            "If the user asks to see a product, image, or document that is in this list, "
            "you MUST invoke the `attach_media` tool immediately. Do not just describe it.\n"
            + media_lines
            + "\n\nCRITICAL MEDIA RULE: If you are sending a user a file/image, you MUST use the `attach_media` tool. "
            "Never apologise or say you lack the capability. Call the tool with the matching keyword."
        )
    else:
        media_section = "MEDIA ASSETS: No media assets have been uploaded for this tenant yet."

    # Build automotive appointment section if this is an auto-service tenant
    tenant_name_lower = state['tenant_name'].lower()
    is_automotive = any(kw in tenant_name_lower for kw in ["auto", "car", "motor", "vehicle", "repair", "garage", "service"])

    if is_automotive:
        appointment_section = """
APPOINTMENT BOOKING (Automotive Only):
You can book service appointments using the book_appointment tool.

FOLLOW THIS EXACT 3-MESSAGE FLOW:

MESSAGE 1 — When user mentions booking/service, ask ONLY:
  • Their full name
  • Vehicle make, model & year (e.g. Honda City 2026)

Example: "Happy to book your appointment! 🔧 Please share your name and vehicle details (make, model & year)."

MESSAGE 2 — Once you have name & vehicle:
- If you ALREADY identified the required services (e.g. from a previous damage assessment photo), SKIP presenting the menu and move directly to MESSAGE 3.
- Otherwise, type out the full services menu as a plain TEXT message. List each service and its price from the catalog below, then ask: "Which service(s) would you like? You can choose multiple — just list them!"

⚠️ CRITICAL: Do NOT call attach_media for the services list. Do NOT send any file or document. Type the services menu as plain text in your reply.

MESSAGE 3 — Once user picks their services, ask ONLY:
  • Preferred date
  • Preferred time

Example: "Perfect! What date and time works best for you? 🗓️"

Once the user replies with date & time → immediately call book_appointment.

CRITICAL SERVICES RULE:
- Include EVERY service the customer selected.
- Format: comma-separated "ServiceName:price" pairs.
- Example: "Synthetic Engine Oil & Filter Change:2500,Brake Pad Replacement:1800"
- If a service isn't in the catalog, include it with price 0: "Custom Service:0"

After calling book_appointment, confirm:
"✅ Your appointment is confirmed for [date] at [time]. Your invoice has been sent to this WhatsApp. See you soon! 🔧"

IMPORTANT: Strictly follow the 3-message flow. Do NOT ask for everything at once.
Do NOT call attach_media at any point during the booking flow.
Do NOT call book_appointment until you have ALL of: name, vehicle, services, date, time.
"""
    else:
        appointment_section = ""

    # Build image handling section (automotive gets damage assessment, others get generic)
    if is_automotive:
        image_handling_section = (
            "IMAGE HANDLING - AUTOMOTIVE DAMAGE ASSESSMENT:\n"
            "When a customer sends a car photo, you will receive a Vision AI description of it. Use it to:\n\n"
            "1. IDENTIFY the visible damage clearly and empathetically.\n"
            "   e.g. 'I can see significant front-end collision damage: crumpled hood, broken headlights.'\n\n"
            "2. MAP the damage to likely services from your catalog with estimated costs.\n"
            "   List only the relevant services, one per line: ServiceName - Rs.price\n"
            "   (If damage needs a service not in the catalog, note: 'pricing on inspection')\n\n"
            "3. GIVE a total estimated range.\n"
            "   e.g. 'Estimated repair cost: Rs.8,000 - Rs.12,000 (final quote after inspection)'\n\n"
            "4. OFFER to book an appointment: 'Would you like to schedule an appointment to bring it in?'\n\n"
            "5. If customer says YES, start the booking flow (MESSAGE 1: ask name + vehicle). Since you already identified the required services, you will SKIP the services menu in MESSAGE 2.\n\n"
            "TONE: Be empathetic first, then professional and helpful.\n"
            "Do NOT say you cannot assess damage or estimate costs. You always can based on the catalog."
        )
    else:
        image_handling_section = (
            "IMAGE HANDLING:\n"
            "- If you receive an image, describe what you see in the context of the business.\n"
            "- Identify if it's a product, damage claim, or relevant inquiry and respond accordingly."
        )

    system_prompt = f"""You are a helpful customer support and sales agent for {state['tenant_name']}.

{state['tenant_prompt']}

IMPORTANT FORMATTING RULES:
- Never use markdown links like [text](url). WhatsApp does not render them.
- Keep responses concise and friendly for a mobile messaging format.
- If a user asks for an image/file and it's in the assets list, you MUST call `attach_media` rather than just saying "Here it is".

{media_section}
{appointment_section}
SENTIMENT ANALYSIS & ESCALATION RULES:
- Assess the user's emotional state in every message.
- If the user expresses CLEAR frustration, anger, repeated complaints, or
  EXPLICITLY asks to speak with a human (e.g., "I want to talk to a real person",
  "this is ridiculous", "I'm so angry"), you MUST use the escalate_to_human tool.
- Do NOT escalate for minor complaints or simple confusion — only for genuine distress.

CONVERSATION CLOSING RULES:
You have access to the last 5 messages of this conversation. Before deciding
to close the session, reason across the ENTIRE conversation context, not just
the latest message in isolation.

Only call close_conversation if ALL of the following are true:
  1. The user's original question or request appears to have been FULLY answered
     (check the previous bot replies — did we actually resolve what they asked?).
  2. The user's latest message signals satisfaction or wrap-up — such as:
     "thank you", "thanks", "great", "perfect", "got it", "that's all", "bye",
     "goodbye", "see you", "I'm good now", "all done", "cheers", "ok thanks".
  3. There are NO unanswered questions or pending requests visible in the
     recent messages.

Do NOT close if:
  - The user said something like "okay" or "got it" but the conversation clearly
    continues (e.g., they just acknowledged something and may ask more).
  - The latest message is ambiguous without context (e.g., "ok" by itself mid-flow).
  - The user's issue was NOT resolved and they are just being polite.

When you do call close_conversation, write a farewell_message that:
  - Thanks them specifically for what they asked about (personalise it).
  - Reminds them they can message again anytime.
  - Is warm, brief (2-3 sentences max), and conversational in tone.


{image_handling_section}
"""

    # ── Vision Preprocessing (if image) ────────────────────────────────────────
    # Step 1: If an image was received, call Gemini Flash Lite first to get a
    #         rich text description in the context of the tenant's business.
    # Step 2: Inject that description into the Mistral conversation as context.
    # This gives Mistral "eyes" without needing to be a multimodal model itself.
    if state.get("inbound_image_b64"):
        print(f"[agent:llm_reasoning] 🖼️ Running vision preprocessor (Gemini Flash Lite)...")
        vision_prompt = (
            f"You are a vision assistant for {state['tenant_name']}. "
            f"A customer sent this image on WhatsApp. "
            f"Describe what you see clearly and concisely, focusing on details "
            f"relevant to a {state['tenant_name']} business context. "
            f"If the image shows a product, damage, receipt, or document, "
            f"mention it specifically. Keep the description under 3 sentences."
        )
        caption = state["inbound_text"]
        vision_content = [
            {"type": "text", "text": vision_prompt},
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{state['inbound_image_b64']}"},
            },
        ]
        try:
            vision_response = await _vision_llm.ainvoke(
                [HumanMessage(content=vision_content)]
            )
            # Gemini can return content as a plain string OR as a list of
            # content blocks e.g. [{"type": "text", "text": "..."}].
            # Handle both formats.
            raw = vision_response.content
            if isinstance(raw, list):
                image_description = " ".join(
                    block.get("text", "") if isinstance(block, dict) else str(block)
                    for block in raw
                ).strip()
            else:
                image_description = str(raw).strip()
            print(f"[agent:llm_reasoning] 🖼️ Gemini description: {image_description[:120]}...")
        except Exception as e:
            print(f"[agent:llm_reasoning] ⚠️ Vision preprocessor failed: {e}")
            image_description = "the customer sent an image (could not be analysed)"

        # Build the enriched text message for Mistral, combining the image
        # description with any caption the user added
        if caption:
            inbound_human_msg = HumanMessage(
                content=f"[Image received — Vision AI description: {image_description}]\nCustomer caption: {caption}"
            )
        else:
            inbound_human_msg = HumanMessage(
                content=f"[Image received — Vision AI description: {image_description}]"
            )
    else:
        inbound_human_msg = HumanMessage(content=state["inbound_text"])

    # Build full message list: system prompt + conversation history + new message
    messages: list[BaseMessage] = (
        [SystemMessage(content=system_prompt)]
        + state["chat_history"]
        + [inbound_human_msg]
    )

    ai_message: AIMessage = await _llm_with_tools.ainvoke(messages)

    print(
        f"[agent:llm_reasoning] content='{ai_message.content[:80] if ai_message.content else ''}...' | "
        f"tool_calls={[tc['name'] for tc in ai_message.tool_calls]}"
    )

    return {**state, "ai_message": ai_message}


# ---------------------------------------------------------------------------
# Node 4: Dispatcher Node
# ---------------------------------------------------------------------------

async def dispatcher_node(state: AgentState) -> AgentState:
    """
    Constructs the appropriate WhatsApp payload and sends it.
    Then records the outgoing response in the database and
    automatically extinguishes the typing indicator.

    Routing logic:
      - escalate_to_human tool call → set NEEDS_HUMAN, send farewell, HALT
      - attach_media tool call      → send media (image or document)
      - ai_message.content          → send plain text
    """
    ai_message: AIMessage = state["ai_message"]
    from_phone = state["from_phone"]
    session_id = state["session_id"]
    # Normalise media_library (same logic as llm_reasoning_node).
    # Keys are lowercased to match the lowercased keyword from the LLM tool call.
    raw_library = state["media_library"] or []
    if isinstance(raw_library, list):
        media_library: dict[str, str] = {
            item["name"].lower().strip(): item["url"]
            for item in raw_library
            if item.get("name") and item.get("url")
        }
    else:
        media_library: dict[str, str] = {
            k.lower().strip(): v for k, v in raw_library.items()
        }

    try:
        if ai_message.tool_calls:
            for tool_call in ai_message.tool_calls:

                # -------------------------------------------------------------
                # CASE 0a: Book Appointment — save to DB
                # -------------------------------------------------------------
                if tool_call["name"] == "book_appointment":
                    args = tool_call["args"]
                    customer_name = args.get("customer_name", "Customer")
                    vehicle_info = args.get("vehicle_info", "")
                    raw_services = args.get("services", "")
                    appointment_date = args.get("appointment_date", "")
                    appointment_time = args.get("appointment_time", "")
                    notes = args.get("notes", "")

                    # Parse "Name:price,Name:price" into list of dicts
                    parsed_services = []
                    for svc in raw_services.split(","):
                        svc = svc.strip()
                        if ":" in svc:
                            parts = svc.rsplit(":", 1)
                            svc_name = parts[0].strip()
                            try:
                                price = float(parts[1].strip())
                            except ValueError:
                                price = 0.0
                            parsed_services.append({"name": svc_name, "quantity": 1, "unit_cost": price})
                        elif svc:
                            parsed_services.append({"name": svc, "quantity": 1, "unit_cost": 0})

                    appt_id = await invoice_service.save_appointment(
                        tenant_id=state["tenant_id"],
                        session_id=session_id,
                        customer_phone=from_phone,
                        customer_name=customer_name,
                        vehicle_info=vehicle_info,
                        services=parsed_services,
                        appointment_date=appointment_date,
                        appointment_time=appointment_time,
                        notes=notes,
                    )
                    print(f"[agent:dispatcher] 📅 Appointment booked: {appt_id}")

                    # ── Auto-generate & send invoice immediately (local fpdf2, no API key needed) ──
                    import time as _time
                    if parsed_services:
                        invoice_number = str(int(_time.time()))[-8:]
                        print(f"[agent:dispatcher] 🧭 Generating invoice {invoice_number} for {customer_name}...")

                        pdf_bytes = await invoice_service.generate_invoice_pdf(
                            api_key="",  # unused — local fpdf2 generator
                            from_address="Automotive Care\nKrid Services Pvt. Ltd.",
                            to_name=customer_name,
                            customer_phone=from_phone,
                            services=parsed_services,
                            appointment_date=appointment_date,
                            invoice_number=invoice_number,
                            currency="INR",
                        )

                        if pdf_bytes:
                            invoice_url = await invoice_service.upload_pdf_to_storage(
                                pdf_bytes=pdf_bytes,
                                tenant_id=state["tenant_id"],
                                invoice_number=invoice_number,
                            )
                            if invoice_url and appt_id:
                                await invoice_service.mark_appointment_invoiced(appt_id, invoice_url)
                            if invoice_url:
                                out_id = await whatsapp_client.send_document_message(
                                    from_phone,
                                    doc_url=invoice_url,
                                    filename=f"Invoice_{invoice_number}.pdf",
                                    caption="Here is your service invoice. Please review the details.",
                                )
                                if out_id:
                                    await db_client.insert_message(
                                        message_id=out_id,
                                        session_id=session_id,
                                        direction="outbound",
                                        content_type="document",
                                        text_content="[Invoice PDF sent]",
                                        media_url=invoice_url,
                                    )
                                print(f"[agent:dispatcher] 📄 Invoice sent to {from_phone} → {invoice_url}")

                                # Send confirmation text
                                confirmation_text = f"✅ Your appointment is confirmed for {appointment_date} at {appointment_time}. I've sent your invoice. See you soon! 🔧"
                                msg_id = await whatsapp_client.send_text_message(from_phone, confirmation_text)
                                if msg_id:
                                    await db_client.insert_message(
                                        message_id=msg_id,
                                        session_id=session_id,
                                        direction="outbound",
                                        content_type="text",
                                        text_content=confirmation_text
                                    )

                                # Mark session as done
                                await db_client.resolve_session(session_id)
                                print(f"[agent:dispatcher] Session {session_id} resolved after booking.")
                        else:
                            print("[agent:dispatcher] ⚠️ Invoice PDF generation failed")
                    else:
                        print("[agent:dispatcher] ⚠️ No services to invoice")
                    continue

                # -------------------------------------------------------------
                # CASE 0b: generate_and_send_invoice — handled inline above,
                # but keep this case as a fallback if LLM calls it explicitly
                # -------------------------------------------------------------
                elif tool_call["name"] == "generate_and_send_invoice":
                    # Silently skip — invoice is auto-sent by book_appointment handler
                    print("[agent:dispatcher] ℹ️ generate_and_send_invoice skipped (already handled inline)")
                    continue

                # -------------------------------------------------------------
                # CASE 1: Escalation — LLM detected user frustration
                # -------------------------------------------------------------
                if tool_call["name"] == "escalate_to_human":
                    reason = tool_call["args"].get("reason", "User requested human agent.")
                    print(f"[agent:dispatcher] \U0001f6a8 ESCALATING to human: {reason}")

                    farewell = (
                        "I understand your frustration and I sincerely apologise. "
                        "I've escalated this conversation to one of our human agents "
                        "who will be with you shortly. \U0001f64f"
                    )
                    out_id = await whatsapp_client.send_text_message(from_phone, farewell)
                    if out_id:
                        await db_client.insert_message(
                            message_id=out_id,
                            session_id=session_id,
                            direction="outbound",
                            content_type="text",
                            text_content=farewell,
                        )

                    # Set status to NEEDS_HUMAN — worker.py will halt all future auto-replies
                    await db_client.update_session_status(session_id, "NEEDS_HUMAN")
                    print(f"[agent:dispatcher] Session {session_id} \u2192 NEEDS_HUMAN")
                    return state  # Skip the finally block's status reset

                # -------------------------------------------------------------
                # CASE 1b: Close conversation — user said thank you / goodbye
                # -------------------------------------------------------------
                elif tool_call["name"] == "close_conversation":
                    farewell_msg = tool_call["args"].get(
                        "farewell_message",
                        "Thank you for chatting with us! \U0001f60a We're ending this session now. "
                        "Feel free to message us again anytime if you need further assistance."
                    )
                    print(f"[agent:dispatcher] \u2705 CLOSING conversation for session {session_id}")

                    out_id = await whatsapp_client.send_text_message(from_phone, farewell_msg)
                    if out_id:
                        await db_client.insert_message(
                            message_id=out_id,
                            session_id=session_id,
                            direction="outbound",
                            content_type="text",
                            text_content=farewell_msg,
                        )

                    await db_client.resolve_session(session_id)
                    print(f"[agent:dispatcher] Session {session_id} \u2192 RESOLVED (user sign-off)")
                    return state  # Skip finally block's WAITING_FOR_BOT reset

                # -------------------------------------------------------------
                # CASE 2: Media attachment — LLM wants to send an asset
                # -------------------------------------------------------------
                elif tool_call["name"] == "attach_media":
                    keyword = tool_call["args"].get("keyword", "").lower().strip()
                    media_url = media_library.get(keyword)

                    if media_url is None:
                        fallback = f"I'm sorry, I don't have a media asset for '{keyword}' at this time."
                        out_id = await whatsapp_client.send_text_message(from_phone, fallback)
                        if out_id:
                            await db_client.insert_message(
                                message_id=out_id,
                                session_id=session_id,
                                direction="outbound",
                                content_type="text",
                                text_content=fallback,
                            )
                        continue

                    caption = f"Here is your {keyword}."

                    # Determine media type by file extension
                    if media_url.lower().endswith(".pdf") or "export=download" in media_url.lower():
                        out_id = await whatsapp_client.send_document_message(
                            from_phone,
                            doc_url=media_url,
                            filename=f"{keyword}.pdf",
                            caption=caption,
                        )
                        content_type = "document"
                    else:
                        out_id = await whatsapp_client.send_image_message(
                            from_phone,
                            image_url=media_url,
                            caption=caption,
                        )
                        content_type = "image"

                    print(f"[agent:dispatcher] Sent {content_type} '{keyword}' → msg_id={out_id}")

                    if out_id:
                        await db_client.insert_message(
                            message_id=out_id,
                            session_id=session_id,
                            direction="outbound",
                            content_type=content_type,
                            text_content=caption,
                            media_url=media_url,
                        )

        # ---------------------------------------------------------------------
        # CASE 3: Plain text response
        # ---------------------------------------------------------------------
        else:
            text_response = (ai_message.content or "").strip()

            if text_response:
                out_id = await whatsapp_client.send_text_message(from_phone, text_response)
                print(f"[agent:dispatcher] Sent text reply → msg_id={out_id}")
                if out_id:
                    await db_client.insert_message(
                        message_id=out_id,
                        session_id=session_id,
                        direction="outbound",
                        content_type="text",
                        text_content=text_response,
                    )
            else:
                print(f"[agent:dispatcher] WARNING: LLM returned empty content and no tool calls.")

    finally:
        # Always extinguish the typing indicator, even if sending fails.
        # But only reset status to WAITING_FOR_BOT if it wasn't set to NEEDS_HUMAN.
        await whatsapp_client.toggle_typing_indicator(from_phone, on=False)

        # Re-read the current status to avoid overwriting NEEDS_HUMAN
        current_session = await db_client.get_session_by_phone(from_phone)
        if current_session and current_session.get("status") != "NEEDS_HUMAN":
            await db_client.update_session_status(session_id, "WAITING_FOR_BOT")
            print(f"[agent:dispatcher] Session {session_id} unlocked → WAITING_FOR_BOT")

    return state


# ---------------------------------------------------------------------------
# Graph Assembly — 4-Node Pipeline
# ---------------------------------------------------------------------------

def build_agent() -> Any:
    """Compile and return the 4-node LangGraph application."""
    graph = StateGraph(AgentState)

    graph.add_node("acknowledge", acknowledge_node)
    graph.add_node("context_retriever", context_retriever_node)
    graph.add_node("llm_reasoning", llm_reasoning_node)
    graph.add_node("dispatcher", dispatcher_node)

    graph.set_entry_point("acknowledge")
    graph.add_edge("acknowledge", "context_retriever")
    graph.add_edge("context_retriever", "llm_reasoning")
    graph.add_edge("llm_reasoning", "dispatcher")
    graph.add_edge("dispatcher", END)

    return graph.compile()


# Singleton compiled agent — imported and called by worker.py
agent_app = build_agent()


# ---------------------------------------------------------------------------
# Public Runner
# ---------------------------------------------------------------------------

async def run(
    session_id: str,
    tenant_id: str,
    from_phone: str,
    inbound_text: str,
    message_id: str,
    timestamp: datetime,
    message_type: str = "text",
    media_id: str | None = None,
) -> None:
    """
    Entry point called by worker.py after routing and concurrency checks pass.
    Runs the full 4-node LangGraph pipeline for an inbound message.
    """
    initial_state: AgentState = {
        "session_id": session_id,
        "tenant_id": tenant_id,
        "from_phone": from_phone,
        "inbound_text": inbound_text,
        "message_id": message_id,
        "timestamp": timestamp,
        "message_type": message_type,
        "media_id": media_id,
        # Populated by nodes:
        "inbound_image_b64": None,
        "tenant_name": "",
        "tenant_prompt": "",
        "media_library": {},
        "chat_history": [],
        "ai_message": None,
    }

    await agent_app.ainvoke(initial_state)
