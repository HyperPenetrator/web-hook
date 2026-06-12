# EduHook Link - Application Context & Architecture

This document provides a comprehensive overview of the **EduHook Link** codebase, its architectural components, design choices, data schemas, and key integration points. It serves as developer context for maintenance, feature additions, and system updates.

---

## 📖 Overview & Purpose
**EduHook Link** is an AI-powered document distribution platform designed primarily for educational institutions. It allows students to request institutional documents (e.g., fee structures, schedules, syllabi) in natural language and receive secure, direct download links instantly on WhatsApp. 

The system leverages:
- **Vector Embeddings (Google Gemini API):** For semantic interpretation of student requests.
- **Supabase (PostgreSQL + pgvector):** For similarity search and persistence of resource metadata and WhatsApp authentication state.
- **WhatsApp Web (Baileys) or Meta Cloud API:** For communication with the user.
- **Supabase Storage:** For storing and serving the files securely.
- **React Frontend:** A portal for students to submit request forms manually, and an administrative portal for uploading and indexing documents.

---

## 🛠️ Architecture & Data Flow

### 1. Document Indexing Flow (Admin Upload)
1. **Upload:** Admin uploads a document (`.pdf`, `.docx`, `.txt`) through the password-protected Admin Dashboard.
2. **Text Parsing:** The backend extracts text using specialized parsers (`pdf-parse` / `mammoth`).
3. **Embedding Generation:** The text is parsed, and an embedding vector (768 dimensions) is generated using the Google Gemini embedding model.
4. **Storage:**
   - The document is uploaded to the Supabase Storage public bucket (`documents`).
   - The resource name, Supabase file URL/ID, and embedding vector are saved into the `resources` table in the PostgreSQL database.

### 2. Request & Retrieval Flow (Student Search / WhatsApp Bot)
1. **Query:** A student sends a message on WhatsApp (*"can I get the semester fee structure?"*) or types it in the web request form.
2. **Query Embedding:** The system generates a vector embedding for the student's message using the Gemini API.
3. **Similarity Search:** A SQL query utilizes PostgreSQL `pgvector` and the cosine distance operator (`<=>`) via the `match_resources` RPC function to find the document with the highest semantic similarity above a defined threshold.
4. **WhatsApp Delivery:** The bot responds with the best-matching document name and its secure Supabase Storage download link.

---

## 📦 Key Technical Components & Modules

### Core Backend (`index.js`)
Handles security headers (`helmet`), CORS configuration, rate limits (both global and strict rate limits for document requests), API routes integration, Sentry error tracking initialization, and static serving of the production React build.

### WhatsApp Adapter (`services/whatsappService.js`)
Supports a **dual-mode** setup:
1. **Baileys Mode (Default):** Runs an unofficial WhatsApp Web client. To handle hosting in ephemeral environments (like Hugging Face Spaces or container platforms), the authentication state is saved key-by-key in the Supabase database (`whatsapp_auth` table). This prevents the need to re-scan the QR code every time the server restarts.
2. **Meta Cloud API Mode:** An official API implementation that uses the Webhook endpoint to receive messages and uses Meta endpoints to send messages.

### Matching & Embeddings (`services/matchingService.js` & `services/embeddingService.js`)
- **`embeddingService.js`:** Connects to `@google/generative-ai` to retrieve embeddings for documents and queries. It includes local tokenization/fallback strategies if required.
- **`matchingService.js`:** Communicates with the Supabase client to call the SQL function `match_resources` and return candidates above the similarity threshold.

### Parsers (`services/parserService.js`)
- Handles text extraction based on mime types:
  - `application/pdf` -> parsed using `pdf-parse`
  - `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (DOCX) -> parsed using `mammoth`
  - `text/plain` -> parsed directly.

### Admin & Routes (`routes/api.js`)
Includes routers for:
- User manual requests (`/request`).
- Meta Cloud API WhatsApp webhooks (`/webhook`).
- Admin Auth (`/admin/login` validating against `ADMIN_PASSWORD` and returning a JWT).
- Admin Uploads (`/admin/upload` extracting text, generating embeddings, uploading to storage, and inserting metadata into Supabase).

---

## 💾 Database Schema Reference

The system relies on a PostgreSQL database (ideally hosted on Supabase) configured with the `pgvector` extension.

### 1. `resources` Table
Stores indexed files and their vector representations.
```sql
CREATE TABLE resources (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    drive_id TEXT, -- Holds the storage public URL/path key
    name TEXT,     -- Document name displayed to users
    embedding VECTOR(768) -- Gemini vector representation
);
```

### 2. `whatsapp_auth` Table
Stores session keys and tokens for Baileys, ensuring that container restarts do not log out the bot.
```sql
CREATE TABLE whatsapp_auth (
    key TEXT PRIMARY KEY,
    value TEXT
);
```

### 3. `match_resources` Database Function
```sql
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
$$ LANGUAGE plpgsql;
```

---

## ⚙️ Deployment & Environment Details

- **Frontend Hosting:** Vercel (or any static provider).
- **Backend Hosting:** Hugging Face Spaces (via the included `Dockerfile` running PM2) or render/railway.
- **Storage:** Supabase Storage bucket named `documents` configured for public read access.
- **Logging:** Structured logging using `pino` with an optional `ALERT_WEBHOOK_URL` to send alert notifications to administrative channels (like Discord or Slack webhooks) during critical errors.
