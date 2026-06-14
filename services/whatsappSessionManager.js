/**
 * whatsappSessionManager.js
 *
 * Singleton session manager service that owns all Baileys sockets.
 * It manages multiple WhatsApp accounts simultaneously, saving auth data for each
 * in 'auth_sessions/<adminId>_<sessionSlug>'.
 */

if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = require('ws');
}

const { EventEmitter } = require('events');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');
const { getSupabaseClient } = require('./supabaseClient');

let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore;

try {
  const baileys = require('@whiskeysockets/baileys');
  makeWASocket = baileys.default;
  useMultiFileAuthState = baileys.useMultiFileAuthState;
  DisconnectReason = baileys.DisconnectReason;
  fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
  makeCacheableSignalKeyStore = baileys.makeCacheableSignalKeyStore;
} catch (err) {
  throw new Error('Baileys dependencies are not installed. Please run npm install @whiskeysockets/baileys');
}

const logger = require('./logger');
const matchingService = require('./matchingService');

const AUTH_SESSIONS_DIR = path.join(__dirname, '..', 'auth_sessions');
const BAILEYS_LOG_LEVEL = process.env.BAILEYS_LOG_LEVEL || 'silent';

class WhatsAppSessionManager extends EventEmitter {
  constructor() {
    super();
    // Map<sessionId, { sock, status, phone, qrDataURL, connectedAt }>
    this.sessions = new Map();
    this.reconnectStates = new Map();
    this.messageQueues = new Map();
  }

  /**
   * Initializes and restores all persisted sessions from disk.
   */
  async restorePersistedSessions() {
    try {
      if (!fs.existsSync(AUTH_SESSIONS_DIR)) {
        fs.mkdirSync(AUTH_SESSIONS_DIR, { recursive: true });
        return;
      }

      const folders = fs.readdirSync(AUTH_SESSIONS_DIR).filter(file => {
        const fullPath = path.join(AUTH_SESSIONS_DIR, file);
        return fs.statSync(fullPath).isDirectory();
      });

      logger.info(`Found ${folders.length} persisted sessions to restore.`);
      for (const folder of folders) {
        logger.info(`Restoring session: ${folder}`);
        this.createSession(folder).catch(err => {
          logger.error(`Error restoring session ${folder}:`, err);
        });
      }
    } catch (err) {
      logger.error('Failed to restore persisted sessions:', err);
    }
  }

  /**
   * Lists all sessions, optionally filtered by admin ID.
   */
  listSessions(adminId = null) {
    const list = [];
    const targetPrefix = adminId ? `${adminId}_` : null;

    for (const [id, session] of this.sessions.entries()) {
      if (targetPrefix && !id.startsWith(targetPrefix)) {
        continue;
      }

      // Strip the prefix for display on the front-end to keep UI clean
      const displayId = targetPrefix ? id.substring(targetPrefix.length) : id;

      list.push({
        id: displayId,
        fullId: id,
        status: session.status,
        phone: session.phone,
        connectedAt: session.connectedAt,
        qrPending: !!session.qrDataURL
      });
    }
    return list;
  }

  /**
   * Gets a session by ID.
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  /**
   * Spawns a new session (or returns existing).
   */
  async createSession(sessionId) {
    if (this.sessions.has(sessionId)) {
      const existing = this.sessions.get(sessionId);
      if (existing.status === 'connected') {
        return existing;
      }
    }

    // Extract adminId from sessionId prefix to handle database query scoping
    const underscoreIndex = sessionId.indexOf('_');
    let adminId = '00000000-0000-0000-0000-000000000000';
    if (underscoreIndex !== -1) {
      adminId = sessionId.substring(0, underscoreIndex);
    }

    logger.info(`Creating WhatsApp session: ${sessionId} (Admin: ${adminId})`);

    const sessionDir = path.join(AUTH_SESSIONS_DIR, sessionId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }

    const { state, saveCreds } = await useMultiFileAuthState(sessionDir);
    const { version } = await fetchLatestBaileysVersion();
    const baileysLogger = pino({ level: BAILEYS_LOG_LEVEL });

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys, baileysLogger),
      },
      logger: baileysLogger,
      getMessage: async () => undefined,
    });

    const sessionObj = {
      sock,
      status: 'connecting',
      phone: state.creds.me ? state.creds.me.id.split(':')[0] : null,
      qrDataURL: null,
      connectedAt: null
    };
    this.sessions.set(sessionId, sessionObj);

    if (!this.messageQueues.has(sessionId)) {
      this.messageQueues.set(sessionId, { queue: [], processing: false });
    }

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        try {
          const qrDataURL = await QRCode.toDataURL(qr);
          sessionObj.qrDataURL = qrDataURL;
          sessionObj.status = 'qr_pending';
          this.emit('session:qr', { sessionId, qrDataURL });
        } catch (qrErr) {
          logger.error(`Failed to generate QR data URL for session ${sessionId}:`, qrErr);
        }
      }

      if (connection === 'open') {
        this.reconnectStates.delete(sessionId);
        
        sessionObj.status = 'connected';
        sessionObj.qrDataURL = null;
        sessionObj.phone = sock.authState.creds.me ? sock.authState.creds.me.id.split(':')[0] : null;
        sessionObj.connectedAt = new Date().toISOString();

        logger.info(`Session ${sessionId} connected successfully! Phone: ${sessionObj.phone}`);
        this.emit('session:connected', {
          sessionId,
          phone: sessionObj.phone,
          connectedAt: sessionObj.connectedAt
        });
      }

      if (connection === 'close') {
        sessionObj.status = 'disconnected';
        sessionObj.connectedAt = null;

        const statusCode = lastDisconnect?.error ? new Boom(lastDisconnect.error)?.output?.statusCode : 0;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        this.emit('session:disconnected', { sessionId, statusCode });

        if (shouldReconnect) {
          let reconnectState = this.reconnectStates.get(sessionId);
          if (!reconnectState) {
            reconnectState = { delay: 3000 };
          } else {
            reconnectState.delay = Math.min(reconnectState.delay * 2, 60000);
          }
          
          logger.warn(`Session ${sessionId} connection closed. Reconnecting in ${reconnectState.delay}ms...`);
          
          const timer = setTimeout(() => {
            this.createSession(sessionId).catch(err => {
              logger.error(`Error during reconnect of session ${sessionId}:`, err);
            });
          }, reconnectState.delay);

          reconnectState.timer = timer;
          this.reconnectStates.set(sessionId, reconnectState);
        } else {
          logger.alert(`Session ${sessionId} logged out permanently. Cleaning up...`);
          await this.removeSession(sessionId);
        }
      }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
      if (type !== 'notify') return;

      for (const msg of messages) {
        if (msg.key.fromMe) continue;
        if (msg.key.remoteJid.endsWith('@g.us')) continue;
        if (msg.key.remoteJid === 'status@broadcast') continue;

        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || null;
        if (!text) continue;

        const senderJid = msg.key.remoteJid;
        const senderPhone = senderJid.split('@')[0];

        logger.info(`[Session ${sessionId}] Message from ${senderPhone}: "${text}"`);
        this.emit('session:message', { sessionId, senderJid, senderPhone, text });

        try {
          // Pass the adminId to scope matching results to this specific admin tenant!
          const match = await matchingService.findBestMatch(text, adminId);
          let replyText;
          if (match) {
            replyText =
              `✅ Here is the document you requested: *${match.fileName}*\n\n` +
              `📎 Download link: ${match.drive_id}`;
          } else {
            let availableList = '';
            try {
              const supabaseClient = getSupabaseClient();
              const { data } = await supabaseClient
                .from('resources')
                .select('name')
                .eq('admin_id', adminId) // Fetch only documents belonging to this admin
                .limit(15);

              if (data && data.length > 0) {
                availableList = '\n\n📁 *Available documents in database:*\n' + data.map(r => `• ${r.name}`).join('\n');
              }
            } catch (dbErr) {
              logger.error(`Failed to retrieve resource list for session ${sessionId} fallback:`, dbErr);
            }

            replyText =
              `😔 Sorry, I couldn't find a document matching your request.\n\n` +
              `Try rephrasing your query (e.g., matching the keywords of the file you need).` + availableList;
          }

          await this.sendMessage(sessionId, senderJid, replyText);
          logger.info(`[Session ${sessionId}] Successfully replied to ${senderPhone}`);
        } catch (err) {
          logger.error(`[Session ${sessionId}] Error handling message from ${senderPhone}:`, err);
          await this.sendMessage(sessionId, senderJid, '⚠️ Something went wrong on my end. Please try again in a moment.').catch(() => {});
        }
      }
    });

    return sessionObj;
  }

  /**
   * Completely removes a session, logs out, and deletes auth files.
   */
  async removeSession(sessionId) {
    logger.info(`Removing session ${sessionId}`);

    const reconnectState = this.reconnectStates.get(sessionId);
    if (reconnectState && reconnectState.timer) {
      clearTimeout(reconnectState.timer);
    }
    this.reconnectStates.delete(sessionId);

    const session = this.sessions.get(sessionId);
    if (session) {
      try {
        if (session.sock) {
          session.sock.logout().catch(() => {});
          session.sock.end();
        }
      } catch (err) {
        logger.error(`Error ending socket for session ${sessionId}:`, err);
      }
      this.sessions.delete(sessionId);
    }

    this.messageQueues.delete(sessionId);

    const sessionDir = path.join(AUTH_SESSIONS_DIR, sessionId);
    if (fs.existsSync(sessionDir)) {
      try {
        await new Promise(resolve => setTimeout(resolve, 500));
        fs.rmSync(sessionDir, { recursive: true, force: true });
        logger.info(`Successfully deleted auth folder for session ${sessionId}`);
      } catch (err) {
        logger.error(`Failed to delete auth directory for session ${sessionId}:`, err);
      }
    }

    this.emit('session:removed', { sessionId });
  }

  /**
   * Sends a message paced via a queue per session.
   */
  async sendMessage(sessionId, phone, text) {
    const session = this.sessions.get(sessionId);
    if (!session || session.status !== 'connected') {
      throw new Error(`WhatsApp session ${sessionId} is not active or connected.`);
    }

    let jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;

    if (!phone.includes('@')) {
      try {
        const [result] = await session.sock.onWhatsApp([phone]);
        if (result && result.exists) {
          jid = result.jid;
          logger.info(`[Session ${sessionId}] Resolved phone number ${phone} to JID ${jid}`);
        }
      } catch (err) {
        logger.warn(`[Session ${sessionId}] Failed to resolve JID for ${phone}, using default`, err);
      }
    }

    return new Promise((resolve, reject) => {
      const qState = this.messageQueues.get(sessionId);
      if (!qState) {
        reject(new Error(`Queue state not initialized for session ${sessionId}`));
        return;
      }
      qState.queue.push({ jid, text, resolve, reject });
      this.processQueue(sessionId);
    });
  }

  async processQueue(sessionId) {
    const qState = this.messageQueues.get(sessionId);
    if (!qState || qState.processing) return;

    qState.processing = true;
    const session = this.sessions.get(sessionId);

    while (qState.queue.length > 0) {
      const { jid, text, resolve, reject } = qState.queue.shift();
      try {
        await new Promise((r) => setTimeout(r, 2500));

        if (!session || !session.sock) {
          throw new Error('Socket is no longer available.');
        }

        const result = await session.sock.sendMessage(jid, { text });
        logger.info(`[Session ${sessionId}] Message sent to ${jid}`);
        resolve(result);
      } catch (error) {
        logger.error(`[Session ${sessionId}] Failed to send message to ${jid}`, error);
        reject(error);
      }
    }

    qState.processing = false;
  }
}

const sessionManager = new WhatsAppSessionManager();
module.exports = sessionManager;
