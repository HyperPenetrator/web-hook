# EduHook Link - Incomplete Features & WhatsApp Scaling Implementation Plan

This document details the diagnostic analysis of the single-number WhatsApp restriction, lists the current incomplete/degraded features in the system, and provides a structured implementation plan to scale the application.

---

## 🔍 Diagnostic: Why the Bot Only Works for `9101390352` (RESOLVED)

### Original Root Cause:
* **Green API / Meta Cloud Sandbox Restriction:** The application was running in developer/sandbox mode, restricted to communicating only with authorized numbers like `919101390352`.

### Baileys Local Fix & LID Support:
* **LID Domain Suffix (`@lid`):** In modern WhatsApp Web protocols, many user accounts are represented via a **Linked Identity (LID)** rather than a plain Phone Number (PN) JID. LID JIDs end with the `@lid` suffix (e.g. `113726707519642@lid`). 
* **Fix Applied:** We updated [whatsappService.js](file:///d:/Projects/Whatsapp_hook/services/whatsappService.js) to preserve the full JID (including `@lid` and `@s.whatsapp.net` suffixes) when receiving messages and replying. Outbound messaging requests now pre-resolve raw phone numbers into their correct JID format using `sock.onWhatsApp([phone])` *before* hitting the pacing queue.

---

## ⚠️ Incomplete & Degraded Features (STATUS UPDATE)

### 1. Gemini Embedding Service Degradation (FIXED)
* **Status:** Resolved.
* **Details:** 
  * Replaced the hardcoded/expired Gemini API key in `test_gemini.js` and `list_models.js` to clear GitHub Secret Scanning security alerts. The backend now loads a valid key dynamically via environment variables.
  * Resolved a library compatibility issue in [parserService.js](file:///d:/Projects/Whatsapp_hook/services/parserService.js) where `pdf-parse` returned a constructor function nested under `.PDFParse` rather than a direct function. We added robust check logic to instantiate it using `new pdfParse.PDFParse(new Uint8Array(fileBuffer))` and extract text using `.getText()`.
  * Created a database maintenance utility script (`reindex.js`) to re-embed all documents in the database using the updated Gemini API space.

### 2. Slow Response Overhead (FIXED)
* **Status:** Resolved.
* **Details:** 
  * **Query Match Cache:** Added an in-memory cache (`queryCache`) to [matchingService.js](file:///d:/Projects/Whatsapp_hook/services/matchingService.js). Identical queries (e.g., repeating `"resume"`) bypass Gemini and Supabase entirely, returning matches instantly.
  * **Cache Invalidation:** Configured the file upload route (`/admin/upload` in [api.js](file:///d:/Projects/Whatsapp_hook/routes/api.js)) to call `clearCache()` on successful uploads, preventing stale `null` matches.
  * **Pre-Resolved JIDs:** Shifted `onWhatsApp` JID resolution outside the message pacing loop to keep the 2.5-second pacing delay fast and free of network blocking.

### 3. Cosine Similarity Matching Threshold (TUNED)
* **Status:** Resolved.
* **Details:** 
  * Shifted threshold filtering to the application layer (Node) while querying pgvector with a `0.0` threshold to log raw scores.
  * Adjusted matching threshold in [matchingService.js](file:///d:/Projects/Whatsapp_hook/services/matchingService.js) to **`0.55`** based on real-world diagnostics logging. This allows successful matching of single-word queries against rich full-text documents (like a detailed resume scoring `0.59`) while still filtering out unrelated files.

### 4. Lack of Output Message Queuing
* **Status:** Active.
* **Details:** Outbound messages are paced via an in-memory queue. Under high production loads, this should be migrated to a persistent task queuing library like `BullMQ`.

### 5. Stateless Conversational Flow
* **Status:** Incomplete.
* **Details:** The system processes each query as an isolated event. Students cannot ask follow-up questions.

### 6. Admin Dashboard Observability Gap
* **Status:** Incomplete.
* **Details:** The admin dashboard has no screens for monitoring bot traffic, webhook logs, or connection state.

---

## 🚀 Implementation Plan to Scale to 50-100 Numbers

### Phase 1: Gateway Upgrade (Solve the Single-Number Issue)
* [x] **Baileys LID & JID Optimization:** Implement full JID propagation (`@lid` support) and pre-resolve JIDs before queue pacing.
* [ ] **Green API / Meta API Production Activation:** Upgrade to a paid plan or Meta WABA.

### Phase 2: Core Service Hardening
* [x] **Fix Gemini API Embedding Engine:** Verify environment credentials, resolve pdf-parse import crash, and implement maintenance re-indexing utility.
* [x] **Query Caching:** Implement in-memory query match caching and automatic cache invalidation on upload.
* [x] **Similarity Score Tuning:** Optimize thresholds (`0.55` default) and shift filtering to application level for diagnostics.

### Phase 3: Traffic Control & Message Queueing
* [ ] **Implement Persistent Queue (BullMQ / Bottleneck):** Move out-of-memory queue to Redis.
* [ ] **Webhook Immediate Response:** Hard-code webhook routes to respond with `200 OK` within 500ms of receiving payloads.
