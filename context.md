# EduHook Link - Incomplete Features & WhatsApp Scaling Implementation Plan

This document details the diagnostic analysis of the single-number WhatsApp restriction, lists the current incomplete/degraded features in the system, and provides a structured implementation plan to scale the application to handle 50-100 active numbers.

---

## 🔍 Diagnostic: Why the Bot Only Works for `9101390352`

Based on the [railway-logs.log](file:///d:/Projects/Whatsapp_hook/railway-logs.log), the backend **does** receive incoming requests from other numbers, but fails to respond.

### Key Evidence:
1. **Successful Delivery:**
   ```
   Received WhatsApp Green-API message from 919101390352: "cert"
   Sending Green API WhatsApp message to 919101390352...
   Green API message sent to 919101390352
   ```
2. **Failed Delivery:**
   ```
   Received API request from Romen (918761895085): "cert"
   Sending Green API WhatsApp message to 918761895085...
   [ALERT] Green API failed to send message to 918761895085
   ```

### Root Cause:
* **Green API / Meta Cloud Sandbox Restriction:** The application is currently running in developer/sandbox mode. In Green API trial accounts or Meta WhatsApp sandbox setups, the instance is restricted to communicating **only** with authorized numbers (such as the account creator/pairing number `919101390352`). Messages targeted at or incoming from unverified numbers are blocked at the gateway level.

---

## ⚠️ Incomplete & Degraded Features

Before scaling the app, several architectural bottlenecks and configuration degradation issues must be resolved:

### 1. Gemini Embedding Service Degradation (Critical)
* **Status:** Degraded (falling back to local CPU execution).
* **Details:** The logs show that Gemini API embedding generation fails on every single call:
  ```
  [ALERT] Gemini embedding generation failed. Falling back to local Xenova model.
  ```
  This forces the server to generate embeddings locally using the CPU-bound Xenova transformer `all-mpnet-base-v2`. Under load from 50-100 numbers, this local fallback will cause massive CPU spikes, slowing response times to several seconds and potentially causing container crashes.

### 2. Lack of Output Message Queuing
* **Status:** Incomplete.
* **Details:** Outbound messages are currently dispatched synchronously. If multiple requests arrive simultaneously, they will trigger API rate limits (WhatsApp/Green API limits message frequency on non-enterprise lines). This leads to dropped webhooks and lost responses.

### 3. Stateless Conversational Flow
* **Status:** Incomplete.
* **Details:** The system processes each query as an isolated event. Students cannot ask follow-up questions (e.g., *"What is the deadline?"* after retrieving *"exam_schedule.pdf"*).

### 4. Admin Dashboard Observability Gap
* **Status:** Incomplete.
* **Details:** The admin dashboard has no screens for monitoring bot traffic, viewing failed document dispatches, checking webhook logs, or managing WhatsApp connection state.

---

## 🚀 Implementation Plan to Scale to 50-100 Numbers

Below is the step-by-step roadmap to transition the application to a high-capacity, multi-user system.

### Phase 1: Gateway Upgrade (Solve the Single-Number Issue)
* [ ] **Green API / Meta API Production Activation:**
  * Upgrade the Green API instance to a paid plan, or complete the Meta WhatsApp Business Account (WABA) verification.
  * Update environment variables with live credentials (`GREEN_API_ID_INSTANCE` / `GREEN_API_TOKEN_INSTANCE` or live Graph API tokens).
* [ ] **Domain & Webhook Optimization:**
  * Ensure the server uses HTTPS (Railway/Vercel handles this automatically).
  * Configure the live Webhook URL in the provider portal to ensure asynchronous delivery of incoming messages.

### Phase 2: Core Service Hardening
* [ ] **Fix Gemini API Embedding Engine:**
  * Verify the validity of `GEMINI_API_KEY` in production environment settings.
  * Add automatic retry logic with exponential backoff (`p-retry` or custom middleware) in `services/embeddingService.js` to handle transient API rate-limit errors (HTTP 429).
* [ ] **Database Connection Pooling:**
  * Since multiple concurrent users will query Supabase PostgreSQL, ensure connection pooling is configured.
  * Transition database calls to use pgBouncer pooling ports (port `6543`) to prevent connection exhaustion.

### Phase 3: Traffic Control & Message Queueing
* [ ] **Implement Message Queue (BullMQ / Bottleneck):**
  * Introduce a lightweight task queuing library (such as `bottleneck` or an in-memory queue) to schedule and throttle outbound messages.
  * Restrict message dispatch to a safe speed limit (e.g., max 1–2 messages per second) to conform to WhatsApp's anti-spam rules.
* [ ] **Webhook Immediate Response:**
  * Hard-code webhook routes to respond with `200 OK` within 500ms of receiving the payload, offloading all matching logic and outbound messaging to the async queue.

### Phase 4: Conversational State & Context Retention
* [ ] **Add Session State to Supabase:**
  * Create a `whatsapp_sessions` table in the database to store recent conversation context (e.g., last 3 messages and matched resources) for each student number.
  * Clean up expired sessions (older than 30 minutes) using a scheduled cron job or Supabase Edge Functions.

### Phase 5: Dashboard Observability
* [ ] **Implement Traffic Logging & Analytics UI:**
  * Track incoming requests, execution times, similarity scores, and delivery statuses in a new database logs table.
  * Build a basic metrics tab in the React Admin dashboard to display success rates and highlight failed message dispatches.

---

## ⚠️ Crucial Rules to Scale to 50-100 Numbers on Baileys (Free Mode)

Because Baileys uses a normal WhatsApp line, you are subject to WhatsApp's anti-spam detection. If you send too many messages to new numbers too fast, your number will get banned. Follow these rules to keep it safe:

* **Use a Dedicated Number:** Never use your personal phone number. Buy a cheap SIM card dedicated exclusively to this bot.
* **Pacing / Rate Limiting (Queueing):** Do not send 50 messages in the same second. Modify the bot queue to wait 2 to 3 seconds between outbound messages to mimic human behavior.
* **Warm Up the Number:** If it is a brand-new number, don't message 100 people on day one. Send and receive messages with friendly accounts for a few days to build up "reputation" with WhatsApp's servers.
* **Get Users to Message You First:** The safest way to prevent bans is to make sure users initiate the chat (which they do by requesting a file). When a user messages you first, WhatsApp's spam detection score drops significantly.

