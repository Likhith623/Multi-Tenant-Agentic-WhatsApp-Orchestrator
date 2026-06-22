# 🤖 Multi-Tenant Agentic WhatsApp Orchestrator

A production-grade, AI-powered WhatsApp customer support platform that routes incoming messages across **multiple independent business tenants** — each with their own AI persona, media library, and conversation history — using a **4-node LangGraph pipeline** powered by **Mistral AI** and **Gemini Vision**.

---

## 🌐 Deployed URLs

| Service | URL |
|---|---|
| **Admin Dashboard** | https://multi-tenant-agentic-whatsapp-orchestrator-314402711320.asia-south1.run.app/ |
| **Public Webhook (Backend)** | https://multi-tenant-agentic-whatsapp-orchestrator-314402711320.asia-south1.run.app/webhook |
| **Health Check** | https://multi-tenant-agentic-whatsapp-orchestrator-314402711320.asia-south1.run.app/health |

> Both the admin dashboard and the backend webhook are served from the **same Google Cloud Run URL** (`asia-south1` region) via nginx reverse proxy. The `/webhook` and `/api/*` paths route to the FastAPI backend (`:8000`); all other paths serve the Next.js dashboard (`:3000`).

---

## ✨ Feature Overview

### 🧠 AI Agent (LangGraph Pipeline)
- **4-node deterministic pipeline**: Acknowledge → Context Retriever → LLM Reasoning → Dispatcher
- **Dual-LLM architecture**: Mistral Small 2506 for reasoning + tool calling; Gemini Flash Lite for multimodal vision preprocessing
- **Tool calling**: Five agentic tools — `attach_media`, `escalate_to_human`, `close_conversation`, `book_appointment`, `generate_and_send_invoice`
- **Multimodal image analysis**: Customers can send photos (e.g., car damage); Gemini describes the image in business context and feeds it to Mistral
- **Sentiment-aware escalation**: Automatic detection of user frustration → halts bot, flags session `NEEDS_HUMAN`
- **Intelligent conversation closing**: Detects farewell signals, sends warm goodbye, marks session `RESOLVED`
- **Conversation history context**: Last 10 messages injected as LangChain `HumanMessage`/`AIMessage` objects
- **Concurrency guard**: Locks session to `AGENT_RESPONDING` during processing; drops duplicate triggers
- **Inactivity auto-resolver**: Background loop checks every 60s; auto-resolves sessions idle >20 min with a farewell message

### 📱 WhatsApp Integration
- **Read receipts**: Double blue ticks sent immediately on message receipt via Meta Cloud API
- **Typing indicator**: Triggered inside the same read-receipt payload (Meta's only supported method)
- **Text messages**: Supports WhatsApp markdown (`*bold*`, `_italic_`, `~strikethrough~`)
- **Image sending**: Bot sends images via public Supabase Storage URLs
- **Document/PDF sending**: Bot sends PDF invoices and catalogs via WhatsApp document messages
- **Inbound image handling**: Two-step media download (get URL → download bytes) with Authorization header
- **Template messaging**: Fallback to Meta-approved template (`custom_broadcast`) when 24-hour window is closed
- **Webhook signature validation**: HMAC-SHA256 verification using `X-Hub-Signature-256` (timing-attack safe via `hmac.compare_digest`)
- **Status update filtering**: Silently ignores delivery/read status webhooks; only processes real user messages
- **Supports text + image** message types; ignores all others cleanly

### 🏢 Multi-Tenancy
- **Tenant routing menu**: New users receive a numbered menu (1 = Luxury Furniture, 2 = Automotive Care); session is locked to that tenant after selection
- **Per-tenant AI personas**: Each tenant has a `prompt_directions` field that completely shapes the agent's personality and knowledge
- **Per-tenant media libraries**: Each tenant has an isolated media asset store (JSONB in Supabase); the AI only sees its own tenant's media
- **Per-tenant appointments**: Appointment records are scoped by `tenant_id`
- **Unlimited tenants**: Create/delete tenants from the dashboard; no code changes needed

### 📅 Automotive Appointment Booking (End-to-End)
- **Guided 3-step booking flow**: Message 1 collects name + vehicle; Message 2 presents service menu; Message 3 collects date + time
- **Smart flow shortcut**: If damage assessment (photo analysis) already identified services, the menu step is skipped
- **Full services catalog** with prices injected into the system prompt
- **`book_appointment` tool**: Saves appointment to Supabase `appointments` table with customer name, vehicle, services array, date/time, and notes
- **Automatic invoice generation**: Immediately after booking, generates a PDF invoice using `fpdf2` (zero external API calls)
- **GST calculation**: 18% GST automatically added to subtotal
- **PDF upload to Supabase Storage**: Invoice PDF stored at `{tenant_id}/invoices/invoice_{number}.pdf`
- **PDF delivered via WhatsApp**: Invoice sent as a WhatsApp document message to the customer
- **Confirmation message**: Booking confirmation text sent after invoice delivery
- **Session auto-resolved** after successful booking

### 📄 Invoice System
- **Local PDF generation** using `fpdf2` — no external API key needed
- **Professional layout**: Header with invoice number + date, From/To addresses, itemized services table, subtotal, 18% GST, grand total, notes
- **Re-generation & resend**: Dashboard button to regenerate and resend invoice to customer
- **Invoice URL stored**: `invoice_url` saved on the appointment record after upload
- **Status lifecycle**: `SCHEDULED` → `INVOICED` (after invoice sent) → `CANCELLED` (if staff cancels)

### 📢 Broadcast Campaign
- **Blast messages to a list of phone numbers** from within the dashboard
- **Hybrid delivery strategy**: Tries free-form text first (works inside 24-hour window); automatically falls back to `custom_broadcast` Meta-approved template
- **Tenant-scoped**: Select which tenant sends the broadcast
- **Result summary**: Shows success/failed phone number lists after sending
- **Messages logged** to DB for audit trail

### 🖥️ Admin Dashboard (Next.js)
#### Chat Monitor (`/`)
- **Real-time session list** via Supabase Realtime (postgres_changes)
- **Session search** by phone number
- **Status filter tabs**: All Chats / Needs Human / Resolved (with live counts)
- **Session status badges**: `WAITING_FOR_BOT` / `AGENT_RESPONDING` / `NEEDS_HUMAN` / `RESOLVED`
- **Live chat window**: Real-time message stream via Supabase Realtime
- **Typing indicator bubble** shown when session is `AGENT_RESPONDING`
- **Rich message rendering**: Text, image thumbnails, and PDF document attachments with open links
- **Human takeover**: "Override & Take Over" button halts bot and sends handover message to customer
- **Human reply**: Text box enabled only when `NEEDS_HUMAN`; `Enter` key sends; `Shift+Enter` for newlines
- **Typing debounce**: Sends blue ticks to customer when human agent is typing (400ms debounce)
- **Auto blue-tick**: Fires blue ticks on the customer when agent opens a `NEEDS_HUMAN` session
- **Resolve session**: Mark conversation as `RESOLVED`; next customer message starts a fresh session
- **Session persistence**: Last active session ID saved to `localStorage` and restored on reload
- **Tenant switcher**: Sidebar dropdown to switch between tenants; persisted to `localStorage`

#### Media Library (`/media`)
- **Upload files** (JPEG, PNG, GIF, WEBP, PDF) via file picker
- **Name assignment modal**: User gives each file a human-readable name that the AI agent uses to find and send it
- **JPEG conversion**: All images automatically converted to JPEG via canvas (handles PNGs, GIFs, etc. for WhatsApp compatibility)
- **Supabase Storage upload**: Files stored at `krid_tenents/{tenant_id}/{timestamp}_{filename}`
- **Grid thumbnail view** with hover overlay (open / delete actions)
- **Delete media**: Removes from Supabase Storage AND updates tenant's `media_library` JSONB
- **Agent reference table**: Shows name → type → URL mapping (what the AI sees)
- **Media search** by name
- **Real-time refresh** via `refreshTenants()` after every upload/delete

#### Appointments (`/appointments`)  
*(Visible only for Automotive tenant; hidden for Furniture tenant)*
- **Appointments table** with customer name, phone, vehicle, services, date/time, total, status
- **Status filter tabs**: ALL / SCHEDULED / INVOICED / CANCELLED (with counts)
- **Summary stat cards**: Scheduled / Invoiced / Cancelled counts
- **Search**: Filter by customer name, phone number, or vehicle info
- **Appointment detail drawer** (slide-in): Full breakdown of customer, vehicle, services, pricing, GST, total
- **View Invoice PDF** button (opens in new tab)
- **Re-generate & resend invoice** from dashboard (calls `POST /api/appointments/{id}/generate-invoice`)
- **Cancel appointment**: Sets status to `CANCELLED` and sends WhatsApp notification to customer
- **Real-time updates** via Supabase Realtime subscription on `appointments` table

#### Tenants (`/tenants`)
- **List all tenants** with name, UUID, search filter
- **Create new tenant**: Name prompt → inserts tenant with default system prompt and empty media library
- **Delete tenant**: Removes tenant (FK constraint prevents deletion if active sessions exist)

#### Settings (`/settings`)
- **Edit AI system prompt** (per-tenant) via a large textarea
- **Save & refresh**: Saves `prompt_directions` to Supabase and live-refreshes tenant context

#### Global Navigation
- **Collapsible sidebar** with icons: Chat Monitor, Media Library, Appointments, Tenants, Settings
- **Active route highlight** with gradient left-border indicator
- **Broadcast button** in sidebar footer → opens broadcast modal
- **Notification bell**: Shows count badge of `NEEDS_HUMAN` sessions; dropdown lists each session with link
- **Glassmorphism UI**: `silk-card`, `silk-pressed`, `silk-extruded` CSS utility classes for depth

---

## 🏗️ Architecture

```
Customer WhatsApp
       │
       ▼
 Meta Cloud API (webhook POST)
       │
       ▼
 FastAPI /webhook  ──[HMAC-SHA256 verify]──► 401 if invalid
       │
       │  [BackgroundTask — returns 200 immediately]
       ▼
 worker.py
   ├─ Get/Create session (Supabase)
   ├─ Tenant routing menu (first contact)
   ├─ Concurrency guard (AGENT_RESPONDING → drop)
   ├─ NEEDS_HUMAN guard → log inbound, halt bot
   └─ Hand off to agent.run()
       │
       ▼
 ╔══════════════════════════════════════════════╗
 ║         LangGraph 4-Node Pipeline            ║
 ║                                              ║
 ║  [Node 1: Acknowledge]                       ║
 ║    • Mark message read (blue ticks)          ║
 ║    • Typing indicator ON                     ║
 ║    • Insert inbound message to DB            ║
 ║    • Lock session → AGENT_RESPONDING         ║
 ║    • [If image] Download + base64 encode     ║
 ║         │                                    ║
 ║  [Node 2: Context Retriever]                 ║
 ║    • Fetch tenant prompt + media library     ║
 ║    • Fetch last 10 messages from DB          ║
 ║    • Convert to LangChain message objects    ║
 ║         │                                    ║
 ║  [Node 3: LLM Reasoning]                     ║
 ║    • [If image] Gemini Flash Lite vision     ║
 ║      preprocessor → text description        ║
 ║    • Build system prompt (tenant persona,    ║
 ║      media assets, booking flow, sentiment   ║
 ║      rules, close rules, image handling)     ║
 ║    • Invoke Mistral Small 2506 with tools    ║
 ║    • Returns AIMessage (text or tool_calls)  ║
 ║         │                                    ║
 ║  [Node 4: Dispatcher]                        ║
 ║    • book_appointment → save to DB,          ║
 ║      generate PDF, upload, send via WA       ║
 ║    • escalate_to_human → send farewell,      ║
 ║      set NEEDS_HUMAN, halt                   ║
 ║    • close_conversation → send goodbye,      ║
 ║      set RESOLVED, halt                      ║
 ║    • attach_media → detect type (PDF/image), ║
 ║      send document or image message          ║
 ║    • Plain text → send text message          ║
 ║    • [finally] Typing OFF, unlock session    ║
 ╚══════════════════════════════════════════════╝
       │
       ▼
 Supabase (PostgreSQL + Storage)
 Next.js Dashboard (Realtime subscriptions)
```

---

## 🔬 LangGraph Schema

### State Representation (`AgentState` TypedDict)

| Field | Type | Set By | Description |
|---|---|---|---|
| `session_id` | `str` | `worker.py` | Supabase UUID of the active session |
| `tenant_id` | `str` | `worker.py` | UUID of the routing-selected tenant |
| `from_phone` | `str` | `worker.py` | Customer's WhatsApp phone number |
| `inbound_text` | `str` | `worker.py` | Text body or image caption |
| `message_id` | `str` | `worker.py` | WhatsApp message ID (`wamid.xxx`) for read receipt |
| `timestamp` | `datetime` | `worker.py` | UTC timestamp of the inbound message |
| `message_type` | `str` | `worker.py` | `"text"` or `"image"` |
| `media_id` | `str\|None` | `worker.py` | WhatsApp media ID (for image download) |
| `inbound_image_b64` | `str\|None` | Node 1 (Acknowledge) | Base64-encoded JPEG bytes of inbound image |
| `tenant_name` | `str` | Node 2 (Context Retriever) | Business name (e.g., "Automotive Care") |
| `tenant_prompt` | `str` | Node 2 (Context Retriever) | Full AI persona + business instructions |
| `media_library` | `list\|dict` | Node 2 (Context Retriever) | All uploaded media assets for this tenant |
| `chat_history` | `list[BaseMessage]` | Node 2 (Context Retriever) | Last 10 messages as LangChain objects |
| `ai_message` | `AIMessage\|None` | Node 3 (LLM Reasoning) | LLM response (text content + optional tool_calls) |

### Nodes

| Node | Function | Responsibility |
|---|---|---|
| **Node 1** | `acknowledge_node` | Read receipt + typing ON + log inbound msg + lock session + download image |
| **Node 2** | `context_retriever_node` | Fetch tenant record + last 10 messages + format chat history |
| **Node 3** | `llm_reasoning_node` | Vision preprocessing (Gemini) + system prompt assembly + Mistral tool-call inference |
| **Node 4** | `dispatcher_node` | Route tool calls + send WA messages + log outbound + typing OFF + unlock session |

### Edges (Linear Pipeline)

```
START → acknowledge → context_retriever → llm_reasoning → dispatcher → END
```

All edges are **unconditional** — the graph always flows in a straight line. Routing decisions (escalate vs. text vs. media vs. book) happen **inside** the Dispatcher node through Python `if/elif` branching on `tool_call["name"]`.

### Tool Definitions

| Tool | Trigger Condition | Action in Dispatcher |
|---|---|---|
| `attach_media(keyword)` | User requests a file/image from the media library | Lookup URL by keyword, send as image or document message |
| `escalate_to_human(reason)` | User expresses clear frustration or requests a human | Send farewell, set `NEEDS_HUMAN`, halt all future bot replies |
| `close_conversation(farewell_message)` | User signals they are done (goodbye, thanks, etc.) | Send farewell, set `RESOLVED`, halt |
| `book_appointment(...)` | All booking details collected over 3 messages | Save to `appointments` table, generate PDF, upload to Storage, send via WA |
| `generate_and_send_invoice(booking_ref, customer_name)` | Called after booking (LLM explicit call) | No-op — invoice is already auto-sent inline by the `book_appointment` handler |

---

## ⚙️ Environment Variables

### Backend (`backend/.env`)

```env
# ── Supabase ──────────────────────────────────────
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-supabase-service-role-key

# ── Meta / WhatsApp Cloud API ─────────────────────
WHATSAPP_TOKEN=your-meta-permanent-access-token
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WEBHOOK_VERIFY_TOKEN=your-custom-verify-token
META_APP_SECRET=your-meta-app-secret

# ── LLM APIs ──────────────────────────────────────
MISTRAL_API_KEY=your-mistral-api-key
GEMINI_API_KEY=your-gemini-api-key

# ── Broadcast (optional) ──────────────────────────
BROADCAST_TEMPLATE_NAME=custom_broadcast
```

### Frontend (`frontend/.env.local`)

```env
# Supabase public keys (safe to expose in client JS)
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
```

### Where to Get Each Value

| Variable | Source |
|---|---|
| `SUPABASE_URL` | Supabase Dashboard → Project Settings → API → Project URL |
| `SUPABASE_SECRET_KEY` | Supabase Dashboard → Project Settings → API → `service_role` key |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Dashboard → Project Settings → API → `anon` key |
| `WHATSAPP_TOKEN` | Meta Developer Portal → App → WhatsApp → API Setup → Permanent Token |
| `WHATSAPP_PHONE_NUMBER_ID` | Meta Developer Portal → App → WhatsApp → API Setup → Phone Number ID |
| `WEBHOOK_VERIFY_TOKEN` | Any random string you choose (must match what you enter in Meta webhook config) |
| `META_APP_SECRET` | Meta Developer Portal → App → Settings → Basic → App Secret |
| `MISTRAL_API_KEY` | [console.mistral.ai](https://console.mistral.ai) |
| `GEMINI_API_KEY` | [aistudio.google.com](https://aistudio.google.com) |

---

## 🚀 Running Locally (Step-by-Step)

### Prerequisites
- Python 3.11+
- Node.js 20+
- [ngrok](https://ngrok.com) (for webhook tunneling)
- A Supabase project (free tier works)
- Meta Developer App with WhatsApp Business API access

---

### Step 1: Clone & Database Setup

```bash
git clone https://github.com/Likhith623/Multi-Tenant-Agentic-WhatsApp-Orchestrator.git
cd Multi-Tenant-Agentic-WhatsApp-Orchestrator
```

Run the schema in your Supabase SQL editor (`database/schema.sql`):

```sql
-- Creates: tenants, sessions, messages, appointments tables
-- Plus: compound index on (session_id, timestamp DESC)
```

Then seed the two demo tenants:

```bash
cd database
pip install supabase python-dotenv
SUPABASE_URL=https://... SUPABASE_SECRET_KEY=service_role_key python seed.py
```

---

### Step 2: Backend Setup

```bash
cd backend
cp .env.example .env
# Fill in all values in .env (see Environment Variables section above)

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt

uvicorn main:app --reload --port 8000
```

The backend will start on `http://localhost:8000`. Verify with:

```bash
curl http://localhost:8000/health
# → {"status": "ok"}
```

---

### Step 3: Frontend Setup

```bash
cd frontend
cp .env.local.example .env.local   # or create manually
# Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY

npm install
npm run dev
```

Dashboard available at `http://localhost:3000`.

---

### Step 4: Expose the Backend via ngrok

Meta requires a **public HTTPS URL** to register your webhook. ngrok provides this tunnel:

```bash
ngrok http 8000
```

Copy the `https://xxxx.ngrok-free.app` URL.

---

### Step 5: Register the Webhook in Meta

1. Go to [developers.facebook.com](https://developers.facebook.com)
2. Select your app → WhatsApp → Configuration
3. Set **Callback URL**: `https://xxxx.ngrok-free.app/webhook`
4. Set **Verify Token**: same value as `WEBHOOK_VERIFY_TOKEN` in your `.env`
5. Click **Verify and Save**
6. Subscribe to the **messages** webhook field

---

### Step 6: Test End-to-End

Send a WhatsApp message to your test number. You should see:
1. Blue double ticks appear on your phone (read receipt)
2. "Typing..." bubble
3. AI response within a few seconds

---

## ☁️ Deployment (Google Cloud Run)

The project ships with a **single Docker image** containing all three processes (nginx + uvicorn + Next.js), managed by `supervisord`.

### Architecture inside the Container

```
Cloud Run Container (port 8080)
    │
    ├── nginx (PID managed by supervisord)
    │     ├── /webhook, /health, /api/* → proxy to uvicorn :8000
    │     └── / (catch-all) → proxy to Next.js :3000
    │
    ├── uvicorn (FastAPI backend on :8000)
    └── node server.js (Next.js standalone on :3000)
```

### Multi-Stage Dockerfile

| Stage | Base | Purpose |
|---|---|---|
| `frontend-builder` | `node:20-alpine` | `npm ci` + `next build` → `.next/standalone` |
| `backend-builder` | `python:3.11-slim` | `pip install` into `/venv` |
| `runtime` | `python:3.11-slim` | nginx + supervisord + node + venv + Next.js standalone |

### Automatic Deploy via GitHub Actions

Every push to `main` triggers `.github/workflows/deploy.yaml`:

1. Authenticates to Google Cloud via **Workload Identity Federation** (no static SA keys)
2. Creates Artifact Registry repo if missing
3. Builds Docker image (with Supabase public keys as `--build-arg`)
4. Pushes to `asia-south1-docker.pkg.dev`
5. Deploys to Cloud Run with:
   - **Region**: `asia-south1` (Mumbai)
   - **Memory**: 4 GiB
   - **CPU**: 4 vCPUs (no throttling)
   - **Timeout**: 900s (15 min for long LLM calls)
   - **Max instances**: 2
   - All secrets injected as environment variables via `--set-env-vars`

### Required GitHub Secrets

Set these in your repository's **Settings → Secrets → Actions**:

```
SUPABASE_URL
SUPABASE_SECRET_KEY
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
WHATSAPP_TOKEN
WHATSAPP_PHONE_NUMBER_ID
WEBHOOK_VERIFY_TOKEN
META_APP_SECRET
MISTRAL_API_KEY
GEMINI_API_KEY
```

### Manual Build & Deploy

```bash
# Build
docker build \
  --build-arg NEXT_PUBLIC_SUPABASE_URL=https://... \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ... \
  -t my-orchestrator .

# Run locally (pass all backend secrets)
docker run -p 8080:8080 \
  -e SUPABASE_URL=... \
  -e SUPABASE_SECRET_KEY=... \
  -e WHATSAPP_TOKEN=... \
  -e WHATSAPP_PHONE_NUMBER_ID=... \
  -e WEBHOOK_VERIFY_TOKEN=... \
  -e META_APP_SECRET=... \
  -e MISTRAL_API_KEY=... \
  -e GEMINI_API_KEY=... \
  my-orchestrator
```

---

## 🗄️ Database Schema

### `tenants`
```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
name            TEXT NOT NULL
prompt_directions TEXT NOT NULL           -- AI agent system prompt
media_library   JSONB NOT NULL DEFAULT '{}' -- Array of {id,name,url,type,storagePath,size}
```

### `sessions`
```sql
id              UUID PRIMARY KEY DEFAULT gen_random_uuid()
customer_phone  TEXT UNIQUE NOT NULL     -- One active session per phone number
tenant_id       UUID REFERENCES tenants(id)  -- Null until routing selection
status          TEXT NOT NULL DEFAULT 'WAITING_FOR_BOT'
                -- WAITING_FOR_BOT | AGENT_RESPONDING | NEEDS_HUMAN | RESOLVED
updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

### `messages`
```sql
id              TEXT PRIMARY KEY         -- WhatsApp message ID (wamid.xxx)
session_id      UUID NOT NULL REFERENCES sessions(id)
direction       TEXT NOT NULL            -- 'inbound' | 'outbound'
timestamp       TIMESTAMPTZ NOT NULL
content_type    TEXT NOT NULL            -- 'text' | 'image' | 'document'
text_content    TEXT
media_url       TEXT
```
> **Index**: `CREATE INDEX idx_messages_session_timestamp ON messages (session_id, timestamp DESC)` — used by Context Retriever Node for fast history fetch.

### `appointments`
```sql
id               UUID PRIMARY KEY DEFAULT gen_random_uuid()
tenant_id        UUID REFERENCES tenants(id)
session_id       UUID REFERENCES sessions(id)
customer_phone   TEXT NOT NULL
customer_name    TEXT
vehicle_info     TEXT
services         JSONB    -- [{name, quantity, unit_cost}]
appointment_date TEXT
appointment_time TEXT
notes            TEXT
status           TEXT     -- 'SCHEDULED' | 'INVOICED' | 'CANCELLED'
total_amount     NUMERIC
invoice_url      TEXT
created_at       TIMESTAMPTZ DEFAULT NOW()
```

---

## 📦 Tech Stack

### Backend
| Package | Version | Purpose |
|---|---|---|
| `fastapi` | latest | HTTP server, webhook endpoints, REST APIs |
| `uvicorn[standard]` | latest | ASGI server |
| `langgraph` | latest | 4-node agentic pipeline |
| `langchain-core` | latest | Message types, tool definitions |
| `langchain-mistralai` | latest | Mistral Small 2506 integration |
| `langchain-google-genai` | latest | Gemini Flash Lite vision LLM |
| `google-generativeai` | latest | Google GenAI SDK |
| `supabase` | latest | Database client (sync + async) |
| `httpx` | latest | Async HTTP client (Meta API calls) |
| `fpdf2` | latest | Local PDF invoice generation |
| `python-dotenv` | latest | `.env` file loading |
| `pydantic` | latest | Request body validation |

### Frontend
| Package | Version | Purpose |
|---|---|---|
| `next` | 16.2.9 | React framework (App Router, standalone output) |
| `react` | 19.2.4 | UI library |
| `@supabase/supabase-js` | ^2.108.2 | Supabase client + Realtime subscriptions |
| `tailwindcss` | ^4 | Utility-first CSS |
| `typescript` | ^5 | Type safety |

### Infrastructure
| Tool | Purpose |
|---|---|
| Google Cloud Run | Serverless container deployment |
| Google Artifact Registry | Docker image registry |
| GitHub Actions | CI/CD pipeline |
| Supabase (PostgreSQL) | Database, Realtime, Storage |
| nginx | Reverse proxy (single port → two services) |
| supervisord | Multi-process manager (nginx + uvicorn + node) |
| ngrok | Local webhook tunneling |

---

## 📁 Project Structure

```
Multi-Tenant-Agentic-WhatsApp-Orchestrator/
│
├── backend/
│   ├── main.py              # FastAPI app: /webhook, /health, /api/* endpoints
│   ├── agent.py             # LangGraph 4-node pipeline + all tool definitions
│   ├── worker.py            # Pre-flight worker: session routing, concurrency guard
│   ├── db_client.py         # Supabase database helpers (sessions, messages, tenants)
│   ├── whatsapp_client.py   # Meta Cloud API client (send/receive all message types)
│   ├── invoice_service.py   # PDF generation (fpdf2) + Supabase Storage upload
│   ├── requirements.txt     # Python dependencies
│   └── .env.example         # Environment variable template
│
├── frontend/
│   └── src/
│       ├── app/
│       │   ├── page.tsx              # Chat Monitor dashboard
│       │   ├── media/page.tsx        # Media Library manager
│       │   ├── appointments/page.tsx # Appointments manager
│       │   ├── tenants/page.tsx      # Tenant CRUD
│       │   ├── settings/page.tsx     # AI prompt editor
│       │   ├── layout.tsx            # Root layout with TenantProvider
│       │   └── globals.css           # Global styles + silk glassmorphism utilities
│       ├── components/
│       │   └── DashboardLayout.tsx   # Sidebar nav + broadcast modal + notif bell
│       ├── context/
│       │   └── TenantContext.tsx     # Global tenant state + refreshTenants()
│       ├── lib/
│       │   └── supabase.ts           # Supabase client singleton
│       └── types/
│           └── index.ts              # TypeScript: Tenant, Session, Message interfaces
│
├── database/
│   ├── schema.sql           # PostgreSQL DDL (tables + index)
│   └── seed.py              # Seeds two demo tenants
│
├── .github/
│   └── workflows/
│       └── deploy.yaml      # GitHub Actions: build + push + deploy to Cloud Run
│
├── Dockerfile               # Multi-stage: frontend-builder + backend-builder + runtime
├── entrypoint.sh            # Container startup: envsubst nginx config → supervisord
├── supervisord.conf         # Process manager: nginx (waits for backend) + uvicorn + node
├── nginx.conf.template      # Reverse proxy: $PORT → :8000 (backend) / :3000 (frontend)
├── .dockerignore            # Excludes node_modules, .venv, .next cache
└── .gitignore               # Excludes .env files, venv, build artifacts
```

---

## 🔌 API Reference

### Webhook (Meta Integration)

| Method | Path | Description |
|---|---|---|
| `GET` | `/webhook` | Meta webhook verification challenge |
| `POST` | `/webhook` | Inbound WhatsApp message ingress (HMAC-verified) |

### Health

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Returns `{"status": "ok"}` |

### Messages & Sessions

| Method | Path | Description |
|---|---|---|
| `POST` | `/api/messages/send` | Send human agent message to customer |
| `POST` | `/api/sessions/{session_id}/read` | Send blue tick read receipt for session |

### Broadcast

| Method | Path | Body | Description |
|---|---|---|---|
| `POST` | `/api/broadcast` | `{tenant_id, message, phone_numbers[]}` | Blast message to multiple numbers |

### Appointments

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/appointments?tenant_id=&status=` | List appointments (optional status filter) |
| `POST` | `/api/appointments/{id}/cancel` | Cancel appointment + WhatsApp notify |
| `POST` | `/api/appointments/{id}/generate-invoice` | Regenerate + resend invoice PDF |

---

## 🔒 Security

- **Webhook signature**: Every `POST /webhook` validated with HMAC-SHA256 (`X-Hub-Signature-256`). Invalid signatures → `HTTP 401`. Comparison uses `hmac.compare_digest` (constant-time, prevents timing attacks).
- **Supabase service role key**: Only used server-side (never exposed to browser). Frontend uses the anon key with RLS.
- **No static GCP credentials**: GitHub Actions authenticates via Workload Identity Federation (OIDC tokens, not JSON key files).
- **Env vars at runtime**: All secrets injected as Cloud Run environment variables — never baked into the Docker image.
- **Concurrency locking**: `AGENT_RESPONDING` status prevents multiple simultaneous LangGraph runs for the same session.

---

## 🧪 Local Testing Utilities

```bash
# Test Supabase connection
cd backend && python test_supabase.py

# Manually update a media item in DB (migration utility)
cd backend && python update_media.py
```

---

## 🤝 Multi-Tenant Routing Flow

```
Customer sends first WhatsApp message
         │
         ▼
  No existing session → create new session (tenant_id = NULL)
         │
         ▼
  Show routing menu:
    "1️⃣ — Luxury Furniture Support
     2️⃣ — Automotive Care
     Reply with 1 or 2."
         │
         ▼ (user replies "1" or "2")
  Match tenant name → assign tenant_id to session
  Send: "✅ You're now connected to [Tenant Name] support."
         │
         ▼
  All subsequent messages → full 4-node LangGraph pipeline
  (with this tenant's prompt, media library, and history)
```

---

## 📝 Notes

- **Image support**: Only `text` and `image` message types are processed. Audio, video, sticker, location, etc. are silently ignored with a `200 OK` response to Meta.
- **Session lifecycle**: `WAITING_FOR_BOT` → `AGENT_RESPONDING` (during LLM run) → `WAITING_FOR_BOT` (after reply) → `NEEDS_HUMAN` (escalation) or `RESOLVED` (close/inactivity).
- **Inactivity resolution**: The background loop (`_inactivity_resolver_loop`) runs every 60 seconds and auto-resolves any `WAITING_FOR_BOT` session idle for more than 20 minutes. The customer receives a farewell message.
- **WhatsApp markdown**: Bot replies support `*bold*`, `_italic_`, `~strikethrough~` but never use markdown link syntax `[text](url)` as WhatsApp does not render it.
- **Automotive vs. general**: The system automatically detects automotive tenants by checking if the tenant name contains keywords (`auto`, `car`, `motor`, `vehicle`, `repair`, `garage`, `service`) and activates the booking flow + damage assessment prompts.
