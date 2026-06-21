import os
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

url: str = os.environ.get("SUPABASE_URL", "")
key: str = os.environ.get("SUPABASE_SERVICE_KEY") or os.environ.get("SUPABASE_SECRET_KEY", "") # Needs service/secret key to bypass RLS for seeding

if not url or not key:
    print("Please set SUPABASE_URL and SUPABASE_SERVICE_KEY (or SUPABASE_SECRET_KEY) environment variables.")
    exit(1)

supabase: Client = create_client(url, key)

def seed_database():
    print("Seeding database...")
    
    # 1. Clear existing tenants (cascade will handle sessions/messages if set, otherwise we might need to clear them too)
    # Be careful running this in production!
    print("Clearing existing tenants...")
    supabase.table('tenants').delete().neq('id', '00000000-0000-0000-0000-000000000000').execute()
    
    # 2. Insert Tenant A
    tenant_a = {
        "name": "Luxury Furniture Store",
        "prompt_directions": "You are a helpful customer support and sales agent for a luxury furniture store. Be polite, professional, and sophisticated. Offer to show catalogs and images when asked about products.",
        "media_library": {
            "catalog": "https://example.com/luxury_catalog.pdf",
            "sofa": "https://example.com/sofa.jpg",
            "table": "https://example.com/table.jpg"
        }
    }
    
    # 3. Insert Tenant B
    tenant_b = {
        "name": "Automotive Care",
        "prompt_directions": "You are a direct, helpful customer service agent for an automotive care and repair shop. Help schedule appointments and provide diagrams or invoices if asked.",
        "media_library": {
            "invoice": "https://example.com/invoice_template.pdf",
            "diagram": "https://example.com/engine_diagram.jpg",
            "tires": "https://example.com/tires.jpg"
        }
    }

    try:
        response_a = supabase.table('tenants').insert(tenant_a).execute()
        print(f"Inserted Tenant A: {response_a.data[0]['id']}")
        
        response_b = supabase.table('tenants').insert(tenant_b).execute()
        print(f"Inserted Tenant B: {response_b.data[0]['id']}")
        
        print("Seeding complete!")
    except Exception as e:
        print(f"Error during seeding: {e}")

if __name__ == "__main__":
    seed_database()
