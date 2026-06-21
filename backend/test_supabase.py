import os
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

_supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SECRET_KEY"],
)

_supabase.table("sessions").insert({"customer_phone": "123", "status": "WAITING_FOR_BOT"}).execute()
res = _supabase.table("sessions").select("*").eq("customer_phone", "123").maybe_single().execute()
print("maybe_single() when exists:", res)
_supabase.table("sessions").delete().eq("customer_phone", "123").execute()
