import os
import httpx
from dotenv import load_dotenv

load_dotenv()

_PHONE_NUMBER_ID = os.environ["WHATSAPP_PHONE_NUMBER_ID"]
_TOKEN = os.environ["WHATSAPP_TOKEN"]
_BASE_URL = f"https://graph.facebook.com/v20.0/{_PHONE_NUMBER_ID}/messages"
_HEADERS = {
    "Authorization": f"Bearer {_TOKEN}",
    "Content-Type": "application/json",
}


async def mark_message_read(message_id: str) -> None:
    """
    Send a read receipt to Meta for the given message ID.
    This marks the message as read on the user's phone (double blue ticks).
    """
    payload = {
        "messaging_product": "whatsapp",
        "status": "read",
        "message_id": message_id,
    }
    async with httpx.AsyncClient() as client:
        await client.post(_BASE_URL, json=payload, headers=_HEADERS)


async def toggle_typing_indicator(to_phone: str, on: bool = True) -> None:
    """
    Start or stop the native WhatsApp typing indicator ("typing...").
    Call with on=True before LLM processing, on=False after sending the reply.
    Note: WhatsApp automatically clears the indicator after ~25 seconds,
    but explicitly turning it off is good hygiene.
    """
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to_phone,
        "type": "typing_indicator",
        "typing_indicator": {"type": "text" if on else "pause"},
    }
    async with httpx.AsyncClient() as client:
        await client.post(_BASE_URL, json=payload, headers=_HEADERS)


async def send_text_message(to_phone: str, text: str) -> str | None:
    """
    Send a plain text message to the user.
    Supports WhatsApp markdown: *bold*, _italic_, ~strikethrough~.
    Returns the Meta message ID on success.
    """
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to_phone,
        "type": "text",
        "text": {"body": text, "preview_url": False},
    }
    async with httpx.AsyncClient() as client:
        try:
            res = await client.post(_BASE_URL, json=payload, headers=_HEADERS)
            res.raise_for_status()
            data = res.json()
            return data.get("messages", [{}])[0].get("id")
        except httpx.HTTPStatusError as e:
            print(f"[whatsapp_client] Error sending text: {e.response.status_code} - {e.response.text}")
            return None
        except Exception as e:
            print(f"[whatsapp_client] Exception sending text: {e}")
            return None


async def send_image_message(to_phone: str, image_url: str, caption: str = "") -> str | None:
    """
    Send an image to the user using a public URL.
    """
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to_phone,
        "type": "image",
        "image": {"link": image_url, "caption": caption},
    }
    async with httpx.AsyncClient() as client:
        try:
            res = await client.post(_BASE_URL, json=payload, headers=_HEADERS)
            res.raise_for_status()
            data = res.json()
            return data.get("messages", [{}])[0].get("id")
        except httpx.HTTPStatusError as e:
            print(f"[whatsapp_client] Error sending image: {e.response.status_code} - {e.response.text}")
            return None
        except Exception as e:
            print(f"[whatsapp_client] Exception sending image: {e}")
            return None


async def send_document_message(to_phone: str, doc_url: str, filename: str, caption: str = "") -> str | None:
    """
    Send a document (e.g., PDF) to the user using a public URL.
    """
    payload = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": to_phone,
        "type": "document",
        "document": {"link": doc_url, "filename": filename, "caption": caption},
    }
    async with httpx.AsyncClient() as client:
        try:
            res = await client.post(_BASE_URL, json=payload, headers=_HEADERS)
            res.raise_for_status()
            data = res.json()
            return data.get("messages", [{}])[0].get("id")
        except httpx.HTTPStatusError as e:
            print(f"[whatsapp_client] Error sending document: {e.response.status_code} - {e.response.text}")
            return None
        except Exception as e:
            print(f"[whatsapp_client] Exception sending document: {e}")
            return None


async def download_media(media_id: str) -> bytes | None:
    """
    Downloads raw media bytes from Meta's servers using a two-step process:

    Step 1: Retrieve the temporary media URL.
      GET https://graph.facebook.com/v20.0/{media_id}
      Returns: {"url": "https://...", "mime_type": "image/jpeg", ...}

    Step 2: Download the binary data from the temporary URL.
      The download request MUST include the Authorization header,
      otherwise Meta returns a 403.

    Returns raw bytes on success, or None on failure.
    """
    media_api_url = f"https://graph.facebook.com/v20.0/{media_id}"
    auth_headers = {"Authorization": f"Bearer {_TOKEN}"}

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            # Step 1: Get the temporary download URL
            meta_response = await client.get(media_api_url, headers=auth_headers)
            meta_response.raise_for_status()
            media_info = meta_response.json()
            download_url = media_info.get("url")

            if not download_url:
                print(f"[whatsapp_client] No URL returned for media_id={media_id}: {media_info}")
                return None

            print(f"[whatsapp_client] Downloading media from {download_url[:60]}...")

            # Step 2: Download the actual binary data
            media_response = await client.get(download_url, headers=auth_headers)
            media_response.raise_for_status()
            return media_response.content

        except httpx.HTTPStatusError as e:
            print(f"[whatsapp_client] Error downloading media {media_id}: {e.response.status_code} - {e.response.text}")
            return None
        except Exception as e:
            print(f"[whatsapp_client] Exception downloading media {media_id}: {e}")
            return None
