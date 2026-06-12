const pino = require('pino');
require('dotenv').config();

const isProd = process.env.NODE_ENV === 'production';

// Initialize Pino logger
const pinoLogger = pino({
  level: process.env.LOG_LEVEL || (isProd ? 'info' : 'debug'),
  // Use simple JSON logging in production, readable logs in development
  transport: isProd ? undefined : {
    target: 'pino/file',
    options: { destination: 1 } // writes to stdout
  }
});

/**
 * Sends a critical alert to Discord/Slack if a webhook URL is configured.
 * @param {string} message - Alert message
 * @param {Error|null} error - Associated error object
 */
async function sendAlert(message, error = null) {
  const webhookUrl = process.env.ALERT_WEBHOOK_URL;
  if (!webhookUrl) {
    pinoLogger.warn({ msg: 'Alert triggered but ALERT_WEBHOOK_URL is not set.' });
    return;
  }

  try {
    const errorDetails = error ? `\n\`\`\`\n${error.stack || error.message || error}\n\`\`\`` : '';
    const payload = {
      content: `🚨 **EduHook Link System Alert** 🚨\n**Message:** ${message}\n**Environment:** ${process.env.NODE_ENV || 'development'}${errorDetails}\n**Time:** ${new Date().toISOString()}`
    };
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    pinoLogger.info({ msg: 'Alert webhook sent successfully.' });
  } catch (err) {
    pinoLogger.error({ err }, 'Failed to send alert webhook');
  }
}

const logger = {
  info: (msg, details = null) => {
    if (details) pinoLogger.info(details, msg);
    else pinoLogger.info(msg);
  },
  warn: (msg, details = null) => {
    if (details) pinoLogger.warn(details, msg);
    else pinoLogger.warn(msg);
  },
  error: (msg, err = null) => {
    if (err) pinoLogger.error(err, msg);
    else pinoLogger.error(msg);
  },
  debug: (msg, details = null) => {
    if (details) pinoLogger.debug(details, msg);
    else pinoLogger.debug(msg);
  },
  alert: async (msg, err = null) => {
    if (err) pinoLogger.error(err, `[ALERT] ${msg}`);
    else pinoLogger.error(`[ALERT] ${msg}`);
    await sendAlert(msg, err);
  }
};

module.exports = logger;
