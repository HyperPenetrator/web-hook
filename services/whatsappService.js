/**
 * whatsappService.js
 *
 * Refactored WhatsApp Service Adapter.
 * Delegates connection checking and message sending to WhatsAppSessionManager.
 * This preserves compatibility with the rest of the application (like index.js and api.js).
 */

const sessionManager = require('./whatsappSessionManager');
const logger = require('./logger');

/**
 * Returns a Promise that resolves once at least one WhatsApp session is connected.
 */
async function ready() {
  const sessions = sessionManager.listSessions();
  const connected = sessions.find(s => s.status === 'connected');
  if (connected) return Promise.resolve();

  return new Promise((resolve) => {
    const onConnected = ({ sessionId }) => {
      logger.info(`whatsappService: active session connected, resolving ready() for session ${sessionId}`);
      sessionManager.off('session:connected', onConnected);
      resolve();
    };
    sessionManager.on('session:connected', onConnected);
  });
}

/**
 * Sends a text message using the first available connected session.
 * 
 * @param {string} phone - Recipient phone number or JID.
 * @param {string} text - Message contents.
 */
async function sendMessage(phone, text) {
  const sessions = sessionManager.listSessions();
  const connected = sessions.find(s => s.status === 'connected');
  if (!connected) {
    throw new Error('No active/connected WhatsApp sessions available to send message.');
  }

  return sessionManager.sendMessage(connected.id, phone, text);
}

/**
 * Gets the current connection status (true if at least one session is connected).
 */
function getStatus() {
  const sessions = sessionManager.listSessions();
  return sessions.some(s => s.status === 'connected');
}

module.exports = {
  ready,
  sendMessage,
  getStatus,
};
