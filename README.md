---
title: Eduhook Backend
emoji: 💻
colorFrom: indigo
colorTo: red
sdk: docker
pinned: false
---

# ⚡ EduHook Link

> **AI-powered document distribution over WhatsApp — designed for educational institutions.**

EduHook Link enables students to request documents (syllabi, fee structures, exam schedules, forms) and instantly receive a download link on **WhatsApp** — either by messaging the bot directly or submitting a simple web request form. 

The backend extracts text from uploaded documents (PDF, DOCX, TXT) and indexes them using **Google Gemini vector embeddings** for semantic similarity matching.

---

## 🚀 Key Features

* **AI-Powered Semantic Search:** Students search naturally (*"leave application"*, *"exam timetable"*). The system matches requests using Gemini vector embeddings and PostgreSQL `pgvector` similarity search.
* **Dual-Mode WhatsApp Delivery:**
  * **Meta Business Cloud API:** Production-ready official API (stateless).
  * **Baileys (WA Web Client):** Developer-friendly unofficial protocol via QR-code terminal scan.
* **Database-Backed Session Persistence:** WhatsApp authentication state is automatically saved to Supabase (`whatsapp_auth` table). Ephemeral cloud servers (like Hugging Face Spaces free tier) will remain authenticated across restarts without requiring re-scans.
* **Secure Admin Upload Portal:** Features password protection, JWT-based session tokens, strict input validation via `zod`, and uploads directly to cloud storage.
* **Supabase Storage Integration:** Eliminates local filesystem storage (`/uploads`), permitting seamless horizontal scaling.
* **Production Logging & Alerting:** Structured JSON logs via `pino`, Sentry error tracking, and administrative notification webhooks (Slack/Discord) for critical failures.

---

## 🛠️ Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      EduHook Link                       │
│                                                         │
│  ┌──────────────┐     ┌───────────────────────────┐    │
│  │  React SPA   │────▶│    Express.js Backend      │    │
│  │  (Vite)      │     │       (Node.js API)        │    │
│  └──────────────┘     └───────────┬───────────────┘    │
│                                   │                     │
│              ┌────────────────────┼──────────────────┐  │
│              │                    │                  │  │
│    ┌─────────▼──────┐    ┌────────▼───────┐  ┌───────▼─┐│
│    │   Supabase DB  │    │  WhatsApp Bot  │  │Supabase ││
│    │  (pgvector +   │    │  (Baileys /    │  │ Storage ││
│    │  Auth State)   │    │   Cloud API)   │  │(Bucket) ││
│    └────────────────┘    └────────────────┘  └─────────┘│
└─────────────────────────────────────────────────────────┘
```

---

## 📦 Project Structure

```
Whatsapp_hook/
├── index.js                  # App Entry & Security Middleware
├── Dockerfile                # Production Docker Configuration
├── db/
│   └── database.sql          # DB Schemas (Resources, Auth, Similarity Function)
├── routes/
│   └── api.js                # API Endpoints (Admin, Requests, Webhooks)
├── services/
│   ├── whatsappService.js    # Dual-Mode WhatsApp Client Adapter
│   ├── matchingService.js    # Cosine Similarity Database Query Logic
│   ├── embeddingService.js   # Gemini Embedding Generator with Local Fallback
│   ├── parserService.js      # Text Extraction (PDF, DOCX, TXT parser)
│   └── logger.js             # Structured Logging & Webhook Alerting
├── client/                   # React Frontend (Vite)
│   ├── src/
│   │   ├── components/       # StudentRequest, AdminUpload, AdminLogin, ProtectedRoute
│   │   └── App.jsx           # Client Router & Guard Rules
│   └── package.json
└── package.json              # Backend Dependencies & Scripts
```

---

## ⚙️ Environment Variables (`.env`)

Create a `.env` file in the root directory:

```env
PORT=3000
NODE_ENV=production
HOST_URL=http://YOUR_SERVER_IP:3000

# ── Supabase Credentials ──────────────────────────────────────────────────────
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key

# ── Gemini API Credentials ───────────────────────────────────────────────────
GEMINI_API_KEY=your-gemini-api-key

# ── Admin Auth Configuration ──────────────────────────────────────────────────
ADMIN_PASSWORD=your-strong-portal-password
JWT_SECRET=your-random-jwt-key

# ── Meta WhatsApp Cloud API (Optional - Activates Cloud API Mode) ─────────────
# META_WA_ACCESS_TOKEN=your-meta-access-token
# META_WA_PHONE_NUMBER_ID=your-meta-phone-number-id
# META_WA_VERIFY_TOKEN=your-webhook-verification-token

# ── Administrative Alert Webhooks (Optional) ──────────────────────────────────
# ALERT_WEBHOOK_URL=https://discord.com/api/webhooks/your-id
# SENTRY_DSN=your-sentry-dsn-url
```

---

## 💾 Database Setup (Supabase)

Run the following SQL in your **Supabase Dashboard SQL Editor** to set up extensions, tables, policies, and the similarity function:

```sql
-- 1. Enable pgvector extension
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

-- 2. Create resources table
CREATE TABLE IF NOT EXISTS resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drive_id TEXT,
    name TEXT,
    embedding VECTOR(768)
);

-- 3. Create similarity matching function
CREATE OR REPLACE FUNCTION match_resources (
  query_embedding VECTOR(768),
  match_threshold FLOAT,
  match_count INT
)
RETURNS TABLE (
  id UUID,
  drive_id TEXT,
  name TEXT,
  similarity FLOAT
)
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  RETURN QUERY
  SELECT
    resources.id,
    resources.drive_id,
    resources.name,
    1 - (resources.embedding <=> query_embedding) AS similarity
  FROM resources
  WHERE 1 - (resources.embedding <=> query_embedding) > match_threshold
  ORDER BY resources.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 4. Enable Row Level Security (RLS) on resources
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users" ON public.resources;
CREATE POLICY "Enable read access for all users" ON public.resources 
    FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Enable insert access for all users" ON public.resources;
CREATE POLICY "Enable insert access for all users" ON public.resources 
    FOR INSERT TO public WITH CHECK (auth.role() IN ('anon', 'authenticated'));

-- 5. Create whatsapp_auth table (Stateless Cloud Session persistence)
CREATE TABLE IF NOT EXISTS whatsapp_auth (
    key TEXT PRIMARY KEY,
    value TEXT
);

ALTER TABLE whatsapp_auth ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable all access for anon" ON public.whatsapp_auth;
CREATE POLICY "Enable all access for anon" ON public.whatsapp_auth
    FOR ALL TO anon USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Enable all access for authenticated" ON public.whatsapp_auth;
CREATE POLICY "Enable all access for authenticated" ON public.whatsapp_auth
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

---

## 🏃 Local Setup & Development

### 1. Install dependencies
```bash
# Install backend packages
npm install

# Install frontend packages
cd client && npm install && cd ..
```

### 2. Startup development servers
```bash
# Run backend (with hot-reloads) on port 3000
npm run dev

# Run frontend (Vite server) on port 5173
cd client && npm run dev
```

---

## ☁️ Free Production Deployment

For complete free-tier hosting:
* **Frontend:** Host on [Vercel](https://vercel.com). Configure the root build folder as `client` and set the build environment variable `VITE_API_URL` pointing to your running backend.
* **Backend:** Deploy as a Docker container on [Hugging Face Spaces](https://huggingface.co/spaces) using CPU Basic (Free). Set up your secrets matching the `.env` checklist. 
* **Storage:** Configure a public bucket named `documents` in your Supabase storage portal to securely house uploaded files.

