import os
import asyncio
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

_supabase = create_client(
    os.environ["SUPABASE_URL"],
    os.environ["SUPABASE_SECRET_KEY"],
)

# Convert Google Drive view links to direct download links
# We append &name=file.pdf so our dispatcher logic correctly identifies the file type!
catalog_url = "https://drive.google.com/uc?export=download&id=1E9eMCLruI7VFTwdWzMP4ouCxVY826P5D&name=catalog.pdf"
sofa_url = "https://drive.google.com/uc?export=download&id=1kmfRqgR8mEz9NYn9MPhu9Ff3EcqiHL_G&name=sofa.jpg"

res = _supabase.table("tenants").select("*").eq("name", "Luxury Furniture Store").execute()
if res.data:
    tenant_id = res.data[0]["id"]
    media_library = res.data[0].get("media_library", {})
    
    media_library["catalog"] = catalog_url
    media_library["sofa"] = sofa_url
    
    update_res = _supabase.table("tenants").update({"media_library": media_library}).eq("id", tenant_id).execute()
    print("Successfully updated media library for Luxury Furniture Store!")
    print(update_res.data)
else:
    print("Could not find Luxury Furniture Store in DB.")
