'use strict';

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = require('ws');
}

require('dotenv').config();

// Sanitize environment variables (remove surrounding quotes and whitespaces)
for (const key in process.env) {
  if (typeof process.env[key] === 'string') {
    let val = process.env[key].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1).trim();
    }
    process.env[key] = val;
  }
}

const logger = require('./services/logger');

// ─── Validate required environment variables before anything else ─────────────
const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'GEMINI_API_KEY'];
const missing = REQUIRED_ENV.filter((k) => !process.env[k]);
if (missing.length > 0) {
  logger.alert(`Missing required environment variables: ${missing.join(', ')}.`);
  logger.warn('Server starting in degraded mode to allow settings configuration and avoid boot loops.');
}

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const path = require('path');
const fs = require('fs');
const Sentry = require('@sentry/node');

// Initialize Sentry if DSN is provided
if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
  });
  logger.info('Sentry initialized successfully for error tracking.');
}

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// ─── Initialize WhatsApp on startup ──────────────────────────────────────────
const whatsapp = require('./services/whatsappService');

// ─── Security: HTTP headers ───────────────────────────────────────────────────
app.use(helmet({
  // Allow inline scripts/styles for the React SPA in production
  contentSecurityPolicy: IS_PROD ? undefined : false,
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
  : ['http://localhost:5173', 'http://localhost:3000'];

app.use(cors({
  origin: (origin, cb) => {
    // allow server-to-server requests (no origin) and whitelisted origins
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    // allow any *.vercel.app or *.railway.app during testing
    if (origin.endsWith('.vercel.app') || origin.endsWith('.railway.app')) return cb(null, true);
    cb(new Error(`CORS: origin ${origin} not allowed`));
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Body parsing ─────────────────────────────────────────────────────────────
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));

// ─── Rate limiting ────────────────────────────────────────────────────────────
// Global limiter — 200 req / 15 min per IP
const globalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
});
app.use(globalLimiter);

// Stricter limiter for the WhatsApp-send endpoint (prevent spam)
const requestLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 5,              // 5 document requests per minute per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many document requests. Please wait a minute and try again.' },
});

// Deprecated Local uploads static serving removed:
// Files are now served directly and securely via Supabase Storage public links.

// ─── API routes ───────────────────────────────────────────────────────────────
const apiRouter = require('./routes/api');
app.use('/api/request', requestLimiter); // apply strict limiter to send endpoint
app.use('/api', apiRouter);

// ─── WhatsApp status endpoint ─────────────────────────────────────────────────
app.get('/whatsapp/status', (req, res) => {
  const connected = whatsapp.getStatus();
  res.json({
    connected,
    message: connected
      ? '✅ WhatsApp is connected and ready.'
      : '⏳ WhatsApp not connected. Check terminal for QR code.',
  });
});

// ─── Serve React frontend (production only) ───────────────────────────────────
const clientDist = path.join(__dirname, 'client', 'dist');
if (IS_PROD && fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // For any route not matched above, serve the SPA's index.html
  app.get('*', (req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
} else if (!IS_PROD) {
  app.get('/', (req, res) => {
    res.json({
      status: 'ok',
      whatsapp: whatsapp.getStatus() ? 'connected' : 'disconnected',
      frontend: 'Run `npm run dev` inside /client for the React UI',
    });
  });
}

// ─── Global error handler ─────────────────────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  logger.error('[Express Error]', err);
  
  if (process.env.SENTRY_DSN) {
    Sentry.captureException(err);
  }

  const status = err.status || err.statusCode || 500;
  res.status(status).json({ error: IS_PROD ? 'Internal server error' : err.message });
});

// ─── Start server ─────────────────────────────────────────────────────────────
let server;
if (require.main === module) {
  server = app.listen(PORT, '0.0.0.0', () => {
    logger.info(`EduHook Link server running on port ${PORT}`);
    logger.info(`Mode    : ${IS_PROD ? 'production' : 'development'}`);
    logger.info(`Status  : http://localhost:${PORT}/whatsapp/status`);
    if (IS_PROD && fs.existsSync(clientDist)) {
      logger.info(`Frontend: http://localhost:${PORT}/`);
    }
  });

  // ─── Graceful shutdown ──────────────────────────────────────────────────────
  const shutdown = (signal) => {
    logger.info(`${signal} received — shutting down gracefully…`);
    server.close(() => {
      logger.info('HTTP server closed.');
      process.exit(0);
    });
    // Force exit if it takes too long
    setTimeout(() => process.exit(1), 10000);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
}

module.exports = app;
