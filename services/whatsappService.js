/**
 * whatsappService.js
 *
 * Singleton WhatsApp service.
 * Supports two modes:
 *  1. Meta Cloud API Mode: (Production-ready, official, highly reliable)
 *     Uses standard HTTPS Graph API requests to send messages.
 *     Activated if META_WA_ACCESS_TOKEN is configured in environment variables.
 *  2. Baileys Mode: (Local developer friendly, unofficial Web protocol)
 *     Starts a Baileys connection, outputs QR code to terminal, and persists auth state.
 *     Activated if Meta credentials are not present.
 */

const { getSupabaseClient } = require('./supabaseClient');
const { Boom } = require('@hapi/boom');
const pino = require('pino');
const path = require('path');
const fs = require('fs');

// Dynamically loaded Baileys dependencies
let makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, makeCacheableSignalKeyStore, BufferJSON, initAuthCreds, proto;
let qrcode;

function loadBaileys() {
  try {
    const baileys = require('@whiskeysockets/baileys');
    makeWASocket = baileys.default;
    useMultiFileAuthState = baileys.useMultiFileAuthState;
    DisconnectReason = baileys.DisconnectReason;
    fetchLatestBaileysVersion = baileys.fetchLatestBaileysVersion;
    makeCacheableSignalKeyStore = baileys.makeCacheableSignalKeyStore;
    BufferJSON = baileys.BufferJSON;
    initAuthCreds = baileys.initAuthCreds;
    proto = baileys.proto;

    qrcode = require('qrcode-terminal');
    return true;
  } catch (err) {
    return false;
  }
}

const logger = require('./logger');
const matchingService = require('./matchingService');

// ─── Config ──────────────────────────────────────────────────────────────────
const AUTH_DIR = path.join(__dirname, '..', 'whatsapp_auth_state');
const BAILEYS_LOG_LEVEL = process.env.BAILEYS_LOG_LEVEL || 'silent';

// ─── Internal state ───────────────────────────────────────────────────────────
let sock = null;
let isConnected = false;
let readyResolvers = [];

function flushReadyResolvers() {
  const resolvers = readyResolvers;
  readyResolvers = [];
  resolvers.forEach((resolve) => resolve());
}

// ─── Supabase Database Auth State Helper (For stateless Baileys persistence) ──
async function useSupabaseAuthState(supabaseClient) {
  const readData = async (key) => {
    try {
      const { data, error } = await supabaseClient
        .from('whatsapp_auth')
        .select('value')
        .eq('key', key)
        .maybeSingle();

      if (error) {
        logger.error(`Failed to read from Supabase auth table: ${error.message}`);
        return null;
      }
      if (!data || !data.value) return null;
      
      return JSON.parse(data.value, BufferJSON.reviver);
    } catch (err) {
      logger.error(`Error parsing auth data for key ${key}:`, err);
      return null;
    }
  };

  const writeData = async (key, value) => {
    try {
      const stringified = JSON.stringify(value, BufferJSON.replacer);
      const { error } = await supabaseClient
        .from('whatsapp_auth')
        .upsert({ key, value: stringified });

      if (error) {
        logger.error(`Failed to upsert to Supabase auth table: ${error.message}`);
      }
    } catch (err) {
      logger.error(`Error stringifying/writing auth data for key ${key}:`, err);
    }
  };

  const removeData = async (key) => {
    try {
      const { error } = await supabaseClient
        .from('whatsapp_auth')
        .delete()
        .eq('key', key);
      
      if (error) {
        logger.error(`Failed to delete from Supabase auth table: ${error.message}`);
      }
    } catch (err) {
      logger.error(`Error deleting auth data for key ${key}:`, err);
    }
  };

  let creds = await readData('creds');
  if (!creds) {
    creds = initAuthCreds();
    await writeData('creds', creds);
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              data[id] = value;
            })
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) {
                tasks.push(writeData(key, value));
              } else {
                tasks.push(removeData(key));
              }
            }
          }
          await Promise.all(tasks);
        }
      }
    },
    saveCreds: async () => {
      await writeData('creds', creds);
    }
  };
}

// ─── Baileys Connection Logic ──────────────────────────────────────────────────
async function connectBaileys() {
  if (!loadBaileys()) {
    logger.error('WhatsApp service cannot start in Baileys mode because Baileys dependencies are not installed.');
    logger.error('To run Baileys mode locally, run: npm install @whiskeysockets/baileys qrcode-terminal');
    return;
  }
  logger.info('Initializing WhatsApp client via Baileys (WhatsApp Web protocol)...');
  
  let state, saveCreds;
  const hasSupabase = !!(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
  
  if (hasSupabase) {
    logger.info('Using Supabase database-backed WhatsApp authentication state...');
    const supabaseClient = getSupabaseClient();
    const authState = await useSupabaseAuthState(supabaseClient);
    state = authState.state;
    saveCreds = authState.saveCreds;
  } else {
    logger.info(`Using filesystem-backed WhatsApp authentication state at ${AUTH_DIR}...`);
    if (!fs.existsSync(AUTH_DIR)) {
      fs.mkdirSync(AUTH_DIR, { recursive: true });
    }
    const authState = await useMultiFileAuthState(AUTH_DIR);
    state = authState.state;
    saveCreds = authState.saveCreds;
  }

  const { version }          = await fetchLatestBaileysVersion();
  const baileysLogger        = pino({ level: BAILEYS_LOG_LEVEL });

  sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys : makeCacheableSignalKeyStore(state.keys, baileysLogger),
    },
    logger: baileysLogger,
    getMessage: async () => undefined,
  });

  sock.ev.on('creds.update', saveCreds);

  // Request pairing code if BOT_PHONE_NUMBER is set and not already registered
  if (process.env.BOT_PHONE_NUMBER && !sock.authState.creds.registered) {
    setTimeout(async () => {
      try {
        const cleanPhone = process.env.BOT_PHONE_NUMBER.replace(/[^\d]/g, '');
        const code = await sock.requestPairingCode(cleanPhone);
        console.log('\n=============================================');
        console.log(`🔑 [WhatsApp Pairing Code]: ${code}`);
        console.log('Use this in: Linked Devices -> Link with Phone Number');
        console.log('=============================================\n');
      } catch (err) {
        logger.error('Failed to request pairing code:', err);
      }
    }, 5000);
  }

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      if (msg.key.remoteJid.endsWith('@g.us')) continue; // skip groups
      if (msg.key.remoteJid === 'status@broadcast') continue; // skip statuses

      const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || null;
      if (!text) continue;

      const senderJid = msg.key.remoteJid;
      const senderPhone = senderJid.split('@')[0];

      logger.info(`Message received from ${senderPhone}: "${text}"`);

      try {
        const match = await matchingService.findBestMatch(text);
        let replyText;
        if (match) {
          replyText =
            `✅ Here is the document you requested: *${match.fileName}*\n\n` +
            `📎 Download link: ${match.drive_id}`;
        } else {
          let availableList = '';
          try {
            const supabaseClient = getSupabaseClient();
            const { data, error } = await supabaseClient.from('resources').select('name').limit(15);
            if (data && data.length > 0) {
              availableList = '\n\n📁 *Available documents in database:*\n' + data.map(r => `• ${r.name}`).join('\n');
            }
          } catch (dbErr) {
            logger.error('Failed to retrieve resource list for WhatsApp fallback:', dbErr);
          }

          replyText =
            `😔 Sorry, I couldn't find a document matching your request.\n\n` +
            `Try rephrasing your query (e.g., matching the keywords of the file you need).` + availableList;
        }

        await sendMessage(senderJid, replyText);
        logger.info(`Successfully replied to ${senderPhone}`);
      } catch (err) {
        logger.error(`Error handling Baileys message from ${senderPhone}`, err);
        await sendMessage(senderJid, '⚠️ Something went wrong on my end. Please try again in a moment.').catch(() => {});
      }
    }
  });

  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr && !process.env.BOT_PHONE_NUMBER) {
      logger.warn('WhatsApp pairing required. Scan QR code below:');
      console.log('\n📱 [WhatsApp] Scan the QR code below with your WhatsApp app:\n');
      qrcode.generate(qr, { small: true });
      console.log('\n⏳ [WhatsApp] Waiting for scan...\n');
    }

    if (connection === 'open') {
      isConnected = true;
      logger.info('WhatsApp client connected successfully via Baileys!');
      flushReadyResolvers();
    }

    if (connection === 'close') {
      isConnected = false;
      const statusCode = lastDisconnect?.error ? new Boom(lastDisconnect.error)?.output?.statusCode : 0;
      const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

      if (shouldReconnect) {
        logger.warn(`WhatsApp connection closed (code ${statusCode}). Reconnecting in 3s...`);
        setTimeout(connectBaileys, 3000);
      } else {
        logger.alert('WhatsApp client logged out permanently. Clearing authentication state and generating new QR code...', lastDisconnect?.error);
        if (hasSupabase) {
          try {
            const supabaseClient = getSupabaseClient();
            await supabaseClient.from('whatsapp_auth').delete().neq('key', 'keep_alive_placeholder');
          } catch (dbErr) {
            logger.error('Failed to clear whatsapp_auth table in Supabase:', dbErr);
          }
        } else {
          if (fs.existsSync(AUTH_DIR)) {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          }
        }
        setTimeout(connectBaileys, 3000);
      }
    }
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns a Promise that resolves once the WhatsApp client is ready.
 */
function ready() {
  if (isConnected) return Promise.resolve();
  return new Promise((resolve) => readyResolvers.push(resolve));
}

// Simple queue to pace outbound messages and avoid anti-spam bans
const messageQueue = [];
let isProcessingQueue = false;

async function processQueue() {
  if (isProcessingQueue) return;
  isProcessingQueue = true;

  while (messageQueue.length > 0) {
    const { jid, text, resolve, reject } = messageQueue.shift();
    try {
      // 2.5-second pacing delay to mimic human behavior
      await new Promise((r) => setTimeout(r, 2500));

      const result = await sock.sendMessage(jid, { text });
      logger.info(`Baileys message sent to ${jid}`);
      resolve(result);
    } catch (error) {
      logger.error(`Baileys failed to send message to ${jid}`, error);
      reject(error);
    }
  }

  isProcessingQueue = false;
}

/**
 * Sends a text message to a WhatsApp number.
 * 
 * @param {string} phone - Recipient phone number (E.164, without '+' symbol).
 * @param {string} text - Message contents.
 */
async function sendMessage(phone, text) {
  if (!isConnected || !sock) {
    throw new Error('WhatsApp client is not connected via Baileys. Cannot send message.');
  }

  let jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
  
  if (!phone.includes('@')) {
    try {
      const [result] = await sock.onWhatsApp([phone]);
      if (result && result.exists) {
        jid = result.jid;
        logger.info(`Resolved phone number ${phone} to JID ${jid}`);
      }
    } catch (err) {
      logger.warn(`Failed to resolve JID for ${phone} via onWhatsApp, using default JID format`, err);
    }
  }

  return new Promise((resolve, reject) => {
    messageQueue.push({ jid, text, resolve, reject });
    processQueue();
  });
}

/**
 * Gets the current connection status.
 */
function getStatus() {
  return isConnected;
}

// ─── Initialization ──────────────────────────────────────────────────────────
logger.info('WhatsApp service starting in Baileys mode.');
connectBaileys().catch((err) => {
  logger.alert('Fatal failure during WhatsApp socket creation', err);
});

module.exports = {
  ready,
  sendMessage,
  getStatus,
};
