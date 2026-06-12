const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const { z } = require('zod');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const embeddingService = require('../services/embeddingService');
const matchingService = require('../services/matchingService');
const whatsapp = require('../services/whatsappService');
const parserService = require('../services/parserService');
const logger = require('../services/logger');

const router = express.Router();

// Config secrets
const JWT_SECRET = process.env.JWT_SECRET || 'eduhook-default-secret-key-change-in-prod';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

if (JWT_SECRET === 'eduhook-default-secret-key-change-in-prod') {
  logger.warn('WARNING: Using default JWT_SECRET. Please set JWT_SECRET in your .env file.');
}
if (ADMIN_PASSWORD === 'admin123') {
  logger.warn('WARNING: Using default ADMIN_PASSWORD ("admin123"). Please configure ADMIN_PASSWORD in your .env file.');
}

// Supabase client — used only in /admin/upload to insert the resource record.
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Configure Multer for memory storage
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain',
  'image/png',
  'image/jpeg',
  'image/jpg',
]);

const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB max
  fileFilter: (req, file, cb) => {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}. Allowed: PDF, Word, Excel, PPT, TXT, PNG, JPEG.`));
    }
  },
});

// ─── Middleware: JWT authentication ───────────────────────────────────────────
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    logger.warn('Unauthorized request attempt to admin endpoint: missing/malformed token.');
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    logger.warn('Unauthorized request attempt to admin endpoint: invalid token.');
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// ─── POST /admin/login ────────────────────────────────────────────────────────
router.post('/admin/login', (req, res) => {
  try {
    const schema = z.object({
      password: z.string().min(1, 'Password is required')
    });
    
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message });
    }

    const { password } = parseResult.data;
    if (password !== ADMIN_PASSWORD) {
      logger.warn('Failed admin login attempt.');
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    // Issue token expiring in 2 hours
    const token = jwt.sign({ role: 'admin' }, JWT_SECRET, { expiresIn: '2h' });
    logger.info('Successful admin login.');
    return res.json({ token });
  } catch (error) {
    logger.error('Error in POST /admin/login:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /admin/upload ────────────────────────────────────────────────────────
// Accepts a file and optional tags string. Protected by auth.
// Uploads directly to Supabase Storage, parses text, generates Gemini embedding, stores metadata in DB.
router.post('/admin/upload', authenticateAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided.' });
  }

  const { tags } = req.body;
  const { originalname: fileName, mimetype: mimeType, buffer: fileBuffer } = req.file;

  try {
    // 1. Generate unique file name to prevent collisons in storage
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `${uniqueSuffix}-${sanitizedFileName}`;

    logger.info(`Uploading file ${fileName} to Supabase Storage as ${storagePath}...`);

    // 2. Upload file directly to Supabase storage bucket 'documents'
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, fileBuffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Supabase storage upload failed: ${uploadError.message}`);
    }

    // 3. Retrieve public URL
    const { data: urlData } = supabase.storage
      .from('documents')
      .getPublicUrl(storagePath);
    
    const publicUrl = urlData.publicUrl;
    logger.info(`File uploaded successfully. Public URL: ${publicUrl}`);

    // 4. Extract document text content for high-fidelity indexing
    const extractedText = await parserService.extractText(fileBuffer, mimeType, fileName);
    
    // Combine filename, tags, and extracted document text to give AI maximum context
    let textToEmbed = `File Name: ${fileName}\n`;
    if (tags) textToEmbed += `Keywords: ${tags}\n`;
    if (extractedText) {
      textToEmbed += `Content Preview:\n${extractedText}`;
    } else {
      logger.info('No document content extracted; indexing using filename and tags only.');
    }

    // 5. Generate Gemini API vector embedding
    const embedding = await embeddingService.generateEmbedding(textToEmbed);

    // 6. Save metadata and embedding in Supabase resources DB table
    const { error: dbError } = await supabase
      .from('resources')
      .insert([{ drive_id: publicUrl, name: fileName, embedding }]);

    if (dbError) {
      // Cleanup uploaded file on DB failure
      await supabase.storage.from('documents').remove([storagePath]).catch(() => {});
      throw new Error(`Supabase DB insert error: ${dbError.message}`);
    }

    logger.info(`Resource "${fileName}" successfully indexed and saved to DB.`);
    return res.status(201).json({
      message: 'Resource uploaded and indexed successfully.',
      drive_id: publicUrl,
      name: fileName,
    });
  } catch (error) {
    logger.error('Error in POST /admin/upload:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ─── POST /request ──────────────────────────────────────────────────────────
// Accepts name, phone, query. Finds the best matching resource via semantic
// search and sends a WhatsApp message with the download link.
router.post('/request', async (req, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1, 'Name is required').max(100),
      phone: z.string().min(7, 'Phone must be at least 7 digits').max(20),
      query: z.string().min(1, 'Request query is required').max(500),
    });

    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map(e => e.message).join(', ');
      return res.status(400).json({ error: errorMsg });
    }

    let { name, phone, query } = parseResult.data;
    
    // Sanitize input
    name = name.replace(/[\r\n\t]+/g, ' ').trim();
    phone = phone.replace(/[\s\r\n\t]+/g, '').trim();
    query = query.replace(/[\r\n\t]+/g, ' ').trim();

    const normalizedPhone = phone.replace(/[^\d]/g, '');

    logger.info(`Received API request from ${name} (${normalizedPhone}): "${query}"`);

    // Find closest match
    const match = await matchingService.findBestMatch(query);

    if (!match) {
      logger.info(`No matching resources found for query: "${query}"`);
      return res.status(200).json({
        message: 'No matching resources found above the similarity threshold.',
      });
    }

    const { fileName, drive_id } = match;
    const messageText =
      `Hi ${name}, here is your requested file: *${fileName}*\n\n` +
      `📎 Download link: ${drive_id}`;

    await whatsapp.ready();
    await whatsapp.sendMessage(normalizedPhone, messageText);

    return res.status(200).json({
      message: 'Request processed and WhatsApp message sent successfully.',
      matched_resource: { fileName, drive_id },
    });
  } catch (error) {
    logger.error('Error in POST /request:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ─── WhatsApp Webhook Verification (GET /api/webhook) ──────────────────────
// Used by Meta Graph API to verify webhook authenticity.
router.get('/webhook', (req, res) => {
  const verifyToken = process.env.META_WA_VERIFY_TOKEN;
  
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    if (mode === 'subscribe' && token === verifyToken) {
      logger.info('WhatsApp webhook successfully verified.');
      return res.status(200).send(challenge);
    } else {
      logger.warn('WhatsApp webhook verification failed: Verify token mismatch.');
      return res.sendStatus(403);
    }
  }
  return res.sendStatus(400);
});

// ─── WhatsApp Webhook Event Handler (POST /api/webhook) ─────────────────────
// Processes incoming student messages from WhatsApp official API or Green-API.
router.post('/webhook', async (req, res) => {
  try {
    // 1. Handle Green-API Webhook
    if (req.body.typeWebhook === 'incomingMessageReceived') {
      const { senderData, messageData } = req.body;
      if (senderData && messageData && messageData.typeMessage === 'textMessage') {
        const studentPhone = senderData.sender.split('@')[0]; // Extract number without @c.us
        const textBody = messageData.textMessageData.textMessage;
        
        logger.info(`Received WhatsApp Green-API message from ${studentPhone}: "${textBody}"`);
        
        try {
          const match = await matchingService.findBestMatch(textBody);
          let replyText;
          if (match) {
            replyText =
              `✅ Here is the document you requested: *${match.fileName}*\n\n` +
              `📎 Download link: ${match.drive_id}`;
          } else {
            replyText =
              `😔 Sorry, I couldn't find a document matching your request.\n\n` +
              `Try rephrasing — for example: _"leave policy"_, _"exam schedule"_, _"fee structure"_`;
          }

          await whatsapp.sendMessage(studentPhone, replyText);
          logger.info(`Replied to WhatsApp Green-API message to ${studentPhone}`);
        } catch (err) {
          logger.error(`Error processing Green-API webhook message from ${studentPhone}`, err);
          await whatsapp.sendMessage(studentPhone, '⚠️ Something went wrong on my end. Please try again in a moment.').catch(() => {});
        }
      }
      return res.sendStatus(200);
    }

    // 2. Handle Meta Cloud API Webhook
    const entry = req.body.entry;
    if (!entry || entry.length === 0) {
      return res.sendStatus(200);
    }

    const changes = entry[0].changes;
    if (!changes || changes.length === 0) {
      return res.sendStatus(200);
    }

    const value = changes[0].value;
    const messages = value.messages;
    
    if (messages && messages.length > 0) {
      const message = messages[0];
      
      // Process text messages only
      if (message.type === 'text') {
        const studentPhone = message.from; // Student phone number
        const textBody = message.text.body; // Incoming text query
        
        logger.info(`Received WhatsApp Cloud message from ${studentPhone}: "${textBody}"`);

        try {
          const match = await matchingService.findBestMatch(textBody);
          let replyText;
          if (match) {
            replyText =
              `✅ Here is the document you requested: *${match.fileName}*\n\n` +
              `📎 Download link: ${match.drive_id}`;
          } else {
            replyText =
              `😔 Sorry, I couldn't find a document matching your request.\n\n` +
              `Try rephrasing — for example: _"leave policy"_, _"exam schedule"_, _"fee structure"_`;
          }

          await whatsapp.sendMessage(studentPhone, replyText);
          logger.info(`Replied to WhatsApp Cloud message from ${studentPhone}`);
        } catch (err) {
          logger.error(`Error processing webhook message from ${studentPhone}`, err);
          await whatsapp.sendMessage(studentPhone, '⚠️ Something went wrong on my end. Please try again in a moment.').catch(() => {});
        }
      }
    }
    
    // Respond immediately to Meta hook server with 200 OK
    return res.sendStatus(200);
  } catch (error) {
    logger.error('Error handling WhatsApp webhook post:', error);
    return res.sendStatus(500);
  }
});

module.exports = router;
