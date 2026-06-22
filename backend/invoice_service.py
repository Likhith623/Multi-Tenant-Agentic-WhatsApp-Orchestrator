"""
invoice_service.py — Invoice Generation & Storage Utility

Handles all invoice PDF generation via invoice-generator.com API and
uploading the resulting PDF to Supabase Storage for public URL delivery.
"""

import os
import uuid
from datetime import datetime

from fpdf import FPDF
from supabase import AsyncClient, create_async_client

# ---------------------------------------------------------------------------
# Supabase async client (lazy init singleton)
# ---------------------------------------------------------------------------
_sb: AsyncClient | None = None


async def _get_supabase() -> AsyncClient:
    global _sb
    if _sb is None:
        _sb = await create_async_client(
            os.environ["SUPABASE_URL"],
            os.environ["SUPABASE_SECRET_KEY"],
        )
    return _sb


# ---------------------------------------------------------------------------
# Invoice Generator API
# ---------------------------------------------------------------------------

INVOICE_API_URL = "https://invoice-generator.com"
BUCKET = "krid_tenents"


async def generate_invoice_pdf(
    api_key: str,  # Unused now, kept for backward compatibility with calling code
    from_address: str,
    to_name: str,
    customer_phone: str,
    services: list[dict],
    appointment_date: str,
    invoice_number: str,
    currency: str = "INR",
    notes: str = "",
) -> bytes | None:
    """
    Generates a PDF invoice locally using fpdf2.
    Returns raw PDF bytes.
    """
    try:
        pdf = FPDF()
        pdf.add_page()
        
        # Default text color
        pdf.set_text_color(50, 50, 50)
        
        # Header
        pdf.set_font("Helvetica", style="B", size=24)
        pdf.cell(0, 10, txt="INVOICE", new_x="LMARGIN", new_y="NEXT", align="R")
        
        pdf.set_font("Helvetica", size=10)
        pdf.cell(0, 5, txt=f"Invoice #: {invoice_number}", new_x="LMARGIN", new_y="NEXT", align="R")
        pdf.cell(0, 5, txt=f"Date: {appointment_date}", new_x="LMARGIN", new_y="NEXT", align="R")
        pdf.ln(10)
        
        # From / To
        pdf.set_font("Helvetica", style="B", size=12)
        pdf.cell(95, 6, txt="From:", new_x="RIGHT")
        pdf.cell(95, 6, txt="To:", new_x="LMARGIN", new_y="NEXT")
        
        pdf.set_font("Helvetica", size=10)
        from_lines = from_address.split("\n")
        to_lines = [to_name, customer_phone]
        
        for i in range(max(len(from_lines), len(to_lines))):
            f_line = from_lines[i] if i < len(from_lines) else ""
            t_line = to_lines[i] if i < len(to_lines) else ""
            pdf.cell(95, 5, txt=f_line, new_x="RIGHT")
            pdf.cell(95, 5, txt=t_line, new_x="LMARGIN", new_y="NEXT")
            
        pdf.ln(15)
        
        # Table Header
        pdf.set_fill_color(240, 240, 240)
        pdf.set_font("Helvetica", style="B", size=10)
        pdf.cell(100, 8, txt="Item", border=1, fill=True)
        pdf.cell(30, 8, txt="Quantity", border=1, align="C", fill=True)
        pdf.cell(30, 8, txt="Rate", border=1, align="R", fill=True)
        pdf.cell(30, 8, txt="Amount", border=1, align="R", fill=True, new_x="LMARGIN", new_y="NEXT")
        
        # Table Body
        pdf.set_font("Helvetica", size=10)
        subtotal = 0.0
        for s in services:
            name = s.get("name", "Service")
            # fpdf2 requires ascii/latin-1 by default, safe replace
            name = name.encode('latin-1', 'replace').decode('latin-1')
            qty = float(s.get("quantity", 1))
            rate = float(s.get("unit_cost", 0))
            amount = qty * rate
            subtotal += amount
            
            pdf.cell(100, 8, txt=name[:50], border=1)
            pdf.cell(30, 8, txt=str(qty), border=1, align="C")
            pdf.cell(30, 8, txt=f"{rate:,.2f}", border=1, align="R")
            pdf.cell(30, 8, txt=f"{amount:,.2f}", border=1, align="R", new_x="LMARGIN", new_y="NEXT")
            
        # Totals
        tax = subtotal * 0.18
        total = subtotal + tax
        
        pdf.ln(5)
        pdf.cell(160, 6, txt="Subtotal:", align="R")
        pdf.cell(30, 6, txt=f"{subtotal:,.2f}", align="R", new_x="LMARGIN", new_y="NEXT")
        
        pdf.cell(160, 6, txt="GST (18%):", align="R")
        pdf.cell(30, 6, txt=f"{tax:,.2f}", align="R", new_x="LMARGIN", new_y="NEXT")
        
        pdf.set_font("Helvetica", style="B", size=12)
        pdf.cell(160, 8, txt=f"Total ({currency}):", align="R")
        pdf.cell(30, 8, txt=f"{total:,.2f}", align="R", new_x="LMARGIN", new_y="NEXT")
        
        # Notes
        notes_str = notes or "Thank you for choosing us! We look forward to serving you."
        pdf.ln(15)
        pdf.set_font("Helvetica", style="I", size=10)
        pdf.multi_cell(0, 5, txt=notes_str)
        
        # fpdf2 .output() returns a bytearray
        pdf_bytes = bytes(pdf.output())
        print(f"[invoice_service] Local invoice PDF generated: {len(pdf_bytes)} bytes")
        return pdf_bytes
        
    except Exception as e:
        print(f"[invoice_service] Exception generating local invoice PDF: {e}")
        return None


async def upload_pdf_to_storage(
    pdf_bytes: bytes,
    tenant_id: str,
    invoice_number: str,
) -> str | None:
    """
    Uploads a PDF to Supabase Storage under {tenant_id}/invoices/
    Returns the public URL, or None on failure.
    """
    sb = await _get_supabase()
    storage_path = f"{tenant_id}/invoices/invoice_{invoice_number}.pdf"

    try:
        await sb.storage.from_(BUCKET).upload(
            storage_path,
            pdf_bytes,
            {"content-type": "application/pdf", "upsert": "true"},
        )
        # Get the public URL
        url_response = await sb.storage.from_(BUCKET).get_public_url(storage_path)
        print(f"[invoice_service] PDF uploaded → {url_response}")
        return url_response
    except Exception as e:
        print(f"[invoice_service] Storage upload error: {e}")
        return None


async def save_appointment(
    tenant_id: str,
    session_id: str,
    customer_phone: str,
    customer_name: str,
    vehicle_info: str,
    services: list[dict],
    appointment_date: str,
    appointment_time: str,
    notes: str,
) -> str | None:
    """
    Saves a new appointment to the Supabase `appointments` table.
    Returns the new appointment UUID on success.
    """
    sb = await _get_supabase()

    # Calculate total from services
    total = sum(
        s.get("unit_cost", 0) * s.get("quantity", 1) for s in services
    )
    # Add 18% GST
    total_with_tax = round(total * 1.18, 2)

    record = {
        "tenant_id": tenant_id,
        "session_id": session_id,
        "customer_phone": customer_phone,
        "customer_name": customer_name,
        "vehicle_info": vehicle_info,
        "services": services,
        "appointment_date": appointment_date,
        "appointment_time": appointment_time,
        "notes": notes,
        "status": "SCHEDULED",
        "total_amount": total_with_tax,
    }

    try:
        result = await sb.table("appointments").insert(record).execute()
        appt_id = result.data[0]["id"]
        print(f"[invoice_service] Appointment saved: {appt_id}")
        return appt_id
    except Exception as e:
        print(f"[invoice_service] Error saving appointment: {e}")
        return None


async def mark_appointment_invoiced(
    appointment_id: str,
    invoice_url: str,
) -> None:
    """Updates appointment status to INVOICED and saves the invoice PDF URL."""
    sb = await _get_supabase()
    try:
        await (
            sb.table("appointments")
            .update({"status": "INVOICED", "invoice_url": invoice_url})
            .eq("id", appointment_id)
            .execute()
        )
        print(f"[invoice_service] Appointment {appointment_id} → INVOICED")
    except Exception as e:
        print(f"[invoice_service] Error updating appointment status: {e}")
