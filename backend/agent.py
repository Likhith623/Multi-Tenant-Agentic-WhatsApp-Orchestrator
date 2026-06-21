"""
agent.py — LangGraph AI Orchestration Pipeline (4-Node Architecture)

Exactly matches the assignment's Task 3 diagram:

  [Webhook Inbound]
        |
        v
  ┌─────────────────────┐
  │  Acknowledge Node   │──► Send Read Receipt + Typing ON + Save Inbound Msg to DB
  └─────────────────────┘
        |
        v
  ┌─────────────────────────┐
  │  Context Retriever Node │──► Pull tenant rules & last 5 messages from DB
  └─────────────────────────┘
        |
        v
  ┌─────────────────────┐
  │  LLM Reasoning Node │──► Choose response type & assets (text or tool call)
  └─────────────────────┘
        |
        v
  ┌──────────────────┐
  │  Dispatcher Node │──► Send Text/Image/Doc + Save State + Typing OFF
  └──────────────────┘

State flows as a TypedDict, accumulating data across all 4 nodes.
"""

import os
from typing import TypedDict, Any
from datetime import datetime, timezone

from dotenv import load_dotenv
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, BaseMessage
from langchain_core.tools import tool
from langchain_mistralai import ChatMistralAI
from langgraph.graph import StateGraph, END

import db_client
import whatsapp_client

load_dotenv()


# ---------------------------------------------------------------------------
# LLM Setup
# ---------------------------------------------------------------------------

_llm = ChatMistralAI(
    model="mistral-small-2506",
    api_key=os.environ["MISTRAL_API_KEY"],
    temperature=0.4,
)


# ---------------------------------------------------------------------------
# Tool Definition
# ---------------------------------------------------------------------------

@tool
def attach_media(keyword: str) -> str:
    """
    Use this tool when the user is requesting a specific media asset such as
    a product catalog, an image, a diagram, or an invoice.
    Pass the exact keyword that matches the media the user requested.
    Do NOT use markdown links — always use this tool for files.
    """
    # The actual dispatch happens in the dispatcher node.
    # This function body is never called at runtime — the tool signature
    # is only used by the LLM to understand what it can invoke.
    return keyword


_tools = [attach_media]
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
    message_id: str          # Original WhatsApp message ID (for read receipt)
    timestamp: datetime      # Inbound message timestamp (for DB audit log)

    # --- Populated by: Acknowledge Node ---
    # (no new fields; it performs side effects directly)

    # --- Populated by: Context Retriever Node ---
    tenant_name: str
    tenant_prompt: str
    media_library: dict[str, str]   # e.g. {"catalog": "https://..."}
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
      3. Saving the inbound message to the database as PENDING_RESPONSE.
      4. Locking the session (status = AGENT_RESPONDING).

    All subsequent nodes run while the user sees the typing indicator.
    """
    print(f"[agent:acknowledge] Processing message {state['message_id']} from {state['from_phone']}")

    # 1. Send read receipt (double blue ticks)
    await whatsapp_client.mark_message_read(state["message_id"])

    # 2. Fire typing indicator — user sees 'typing...' immediately
    await whatsapp_client.toggle_typing_indicator(state["from_phone"], on=True)

    # 3. Save the inbound message to the database audit log
    await db_client.insert_message(
        message_id=state["message_id"],
        session_id=state["session_id"],
        direction="inbound",
        content_type="text",
        text_content=state["inbound_text"],
        timestamp=state["timestamp"],
    )

    # 4. Lock the session to prevent concurrent double-text processing
    await db_client.update_session_status(state["session_id"], "AGENT_RESPONDING")

    return state


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

    # Fetch last 5 messages using the compound index (fast retrieval)
    raw_messages = await db_client.get_last_n_messages(state["session_id"], n=5)

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
# Node 3: LLM Reasoning Node
# ---------------------------------------------------------------------------

async def llm_reasoning_node(state: AgentState) -> AgentState:
    """
    Invokes mistral-small-2506 to determine the next conversational step.

    Agentic Decision-Making:
      The LLM decides whether to:
        (a) Reply with a plain text string, OR
        (b) Trigger the attach_media tool to send a document/image from
            the Tenant's media library when the user requests visual/data assets.
    """
    media_library: dict = state["media_library"]
    media_keywords = list(media_library.keys())

    system_prompt = f"""You are a helpful customer support and sales agent for {state['tenant_name']}.

{state['tenant_prompt']}

IMPORTANT FORMATTING RULES:
- Never use markdown links like [text](url). WhatsApp does not render them.
- If a user requests a file, catalog, image, or document, you MUST use the attach_media tool.
- If you must share a URL as plain text, type the raw URL directly with no brackets.
- Keep responses concise and friendly for a mobile messaging format.

AVAILABLE MEDIA ASSETS (keywords you can pass to attach_media):
{', '.join(media_keywords) if media_keywords else 'No media assets available.'}

Use the attach_media tool only when the user clearly requests one of these assets.
"""

    # Build full message list: system prompt + conversation history + new message
    messages: list[BaseMessage] = (
        [SystemMessage(content=system_prompt)]
        + state["chat_history"]
        + [HumanMessage(content=state["inbound_text"])]
    )

    ai_message: AIMessage = await _llm_with_tools.ainvoke(messages)

    print(
        f"[agent:llm_reasoning] content='{ai_message.content}' | "
        f"tool_calls={ai_message.tool_calls}"
    )

    return {**state, "ai_message": ai_message}


# ---------------------------------------------------------------------------
# Node 4: Dispatcher Node
# ---------------------------------------------------------------------------

async def dispatcher_node(state: AgentState) -> AgentState:
    """
    Constructs the appropriate WhatsApp payload (text, image, or document)
    and sends it. Then records the outgoing response in the database and
    automatically extinguishes the typing indicator.

    Routing logic:
      - ai_message.tool_calls populated → send media (image or document)
      - ai_message.content populated   → send plain text
    """
    ai_message: AIMessage = state["ai_message"]
    from_phone = state["from_phone"]
    session_id = state["session_id"]
    media_library: dict = state["media_library"]

    try:
        # -------------------------------------------------------------------------
        # CASE 1: Tool call triggered — LLM wants to send a media asset
        # When Mistral fires a tool, content is often empty; payload is in tool_calls.
        # -------------------------------------------------------------------------
        if ai_message.tool_calls:
            for tool_call in ai_message.tool_calls:
                if tool_call["name"] == "attach_media":
                    keyword = tool_call["args"].get("keyword", "").lower().strip()
                    media_url = media_library.get(keyword)

                    if media_url is None:
                        # Keyword not in tenant's library — graceful fallback
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

                    # Determine media type from file extension
                    caption = f"Here is your {keyword}."
                    if media_url.lower().endswith(".pdf"):
                        out_id = await whatsapp_client.send_document_message(
                            from_phone,
                            doc_url=media_url,
                            filename=f"{keyword}.pdf",
                            caption=caption,
                        )
                        content_type = "document"
                    else:
                        # jpg / png / jpeg — treat as image
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

        # -------------------------------------------------------------------------
        # CASE 2: Plain text response — content attribute is populated
        # -------------------------------------------------------------------------
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
        # Always extinguish the typing indicator and unlock the session,
        # even if sending the message fails.
        await whatsapp_client.toggle_typing_indicator(from_phone, on=False)
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
        # Populated by nodes:
        "tenant_name": "",
        "tenant_prompt": "",
        "media_library": {},
        "chat_history": [],
        "ai_message": None,
    }

    await agent_app.ainvoke(initial_state)
