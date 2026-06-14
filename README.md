---
title: Eduhook Backend V2
emoji: ⚡
colorFrom: pink
colorTo: purple
sdk: docker
pinned: false
license: mit
---

# ⚡ EduHook Link

> **AI-powered document distribution over WhatsApp — designed for educational institutions.**

EduHook Link enables students to request documents (syllabi, fee structures, exam schedules, forms) and instantly receive a download link on **WhatsApp** — either by messaging the bot directly or submitting a simple web request form. 

The backend extracts text from uploaded documents (PDF, DOCX, TXT) and indexes them using **Google Gemini vector embeddings** for semantic similarity matching.

---

## 🚀 Key Features

* **AI-Powered Semantic Search:** Students search naturally (*"leave application"*, *"exam timetable"*). The system matches requests using Gemini vector embeddings and PostgreSQL `pgvector` similarity search.
* **Multi-Session WhatsApp Support:** Run multiple WhatsApp accounts simultaneously. Scan, link, and disconnect numbers dynamically.
* **Secure Admin Console Dashboard:** A gorgeous, vanilla JS admin dashboard page at `/admin` (mapped to `/admin/sessions.html`) protected by JWT password authentication to manage and link active numbers in real-time.
* **Pacing & Anti-Spam Queue:** Includes an automatic in-memory queue per session that processes and throttles outbound message dispatches with a 2.5-second delay to protect WhatsApp accounts from automated spam filters.
* **Local Session Persistence:** Multi-device session authorization states are persisted under `auth_sessions/` directories and automatically restored when the backend boots.
* **Secure Admin Upload Portal:** Features password protection, JWT-based session tokens, strict input validation via `zod`, and uploads directly to Supabase cloud storage.
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
│    │  (pgvector +   │    │   (Baileys     │  │ Storage ││
│    │  Auth State)   │    │   WA Client)   │  │(Bucket) ││
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
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# ── Gemini API Credentials ───────────────────────────────────────────────────
GEMINI_API_KEY=your-gemini-api-key

# ── Admin Auth Configuration ──────────────────────────────────────────────────
JWT_SECRET=your-random-jwt-key

# ── WhatsApp Configuration ───────────────────────────────────────────────────
BAILEYS_LOG_LEVEL=silent
# Optional: Set this to link using an 8-digit text code instead of scanning a QR code.
# Format: Country Code + Number (e.g. 919876543210 - no "+" symbol)
# BOT_PHONE_NUMBER=your_bot_phone_number

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

-- 2. Create admins table
CREATE TABLE IF NOT EXISTS admins (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create resources table
CREATE TABLE IF NOT EXISTS resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drive_id TEXT,
    name TEXT,
    embedding VECTOR(768),
    admin_id UUID REFERENCES admins(id) ON DELETE CASCADE
);

-- 4. Create similarity matching function
CREATE OR REPLACE FUNCTION match_resources_v2 (
  query_embedding VECTOR(768),
  match_threshold FLOAT,
  match_count INT,
  p_admin_id UUID DEFAULT NULL
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
  WHERE (p_admin_id IS NULL OR resources.admin_id = p_admin_id)
    AND 1 - (resources.embedding <=> query_embedding) > match_threshold
  ORDER BY resources.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- 5. Enable Row Level Security (RLS)
ALTER TABLE resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Enable read access for all users" ON public.resources;
CREATE POLICY "Enable read access for all users" ON public.resources 
    FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "Enable insert access for all users" ON public.resources;
CREATE POLICY "Enable insert access for all users" ON public.resources 
    FOR INSERT TO public WITH CHECK (auth.role() IN ('anon', 'authenticated'));
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

