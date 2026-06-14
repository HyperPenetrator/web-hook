const express = require('express');
const multer = require('multer');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { z } = require('zod');
const { getSupabaseClient } = require('../services/supabaseClient');
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

// ─── GET /admins ──────────────────────────────────────────────────────────────
router.get('/admins', async (req, res) => {
  try {
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from('admins')
      .select('id, email')
      .order('email');
    
    if (error) {
      if (error.code === '42P01') {
        // Fallback for single admin mode
        return res.json([{ id: '00000000-0000-0000-0000-000000000000', email: 'Default Admin' }]);
      }
      throw new Error(`Database error: ${error.message}`);
    }
    res.json(data);
  } catch (error) {
    logger.error('Error in GET /api/admins:', error);
    res.status(500).json({ error: 'Failed to retrieve admins' });
  }
});

// ─── POST /admin/register ─────────────────────────────────────────────────────
router.post('/admin/register', async (req, res) => {
  try {
    const schema = z.object({
      email: z.string().email('Invalid email address'),
      password: z.string().min(6, 'Password must be at least 6 characters')
    });

    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message });
    }

    const { email, password } = parseResult.data;
    const supabase = getSupabaseClient();

    // Generate password hash using Node pbkdf2
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');
    const password_hash = `${salt}:${hash}`;

    const { data, error } = await supabase
      .from('admins')
      .insert([{ email: email.toLowerCase().trim(), password_hash }])
      .select('id, email')
      .single();

    if (error) {
      // Check for duplicate key violation
      if (error.code === '23505') {
        return res.status(409).json({ error: 'An admin with this email already exists.' });
      }
      throw new Error(`Failed to register: ${error.message}`);
    }

    logger.info(`Registered new admin: ${email}`);
    return res.status(201).json({ message: 'Admin registered successfully', admin: data });
  } catch (error) {
    logger.error('Error in POST /admin/register:', error);
    return res.status(500).json({ error: error.message });
  }
});

// ─── POST /admin/login ────────────────────────────────────────────────────────
router.post('/admin/login', async (req, res) => {
  try {
    // If the body doesn't contain email, it might be the legacy single admin password login
    const isLegacyLogin = !req.body.email;

    if (isLegacyLogin) {
      const schema = z.object({
        password: z.string().min(1, 'Password is required')
      });
      const parseResult = schema.safeParse(req.body);
      if (!parseResult.success) {
        return res.status(400).json({ error: parseResult.error.errors[0].message });
      }

      const { password } = parseResult.data;
      if (password !== ADMIN_PASSWORD) {
        logger.warn('Failed admin login attempt (legacy password).');
        return res.status(401).json({ error: 'Invalid credentials.' });
      }

      const token = jwt.sign(
        { id: '00000000-0000-0000-0000-000000000000', email: 'legacy-admin@local', role: 'admin' },
        JWT_SECRET,
        { expiresIn: '2h' }
      );
      logger.info('Successful legacy admin login.');
      return res.json({ token });
    }

    // Standard Multi-Admin Email/Password login
    const schema = z.object({
      email: z.string().email('Invalid email address'),
      password: z.string().min(1, 'Password is required')
    });
    
    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: parseResult.error.errors[0].message });
    }

    const { email, password } = parseResult.data;
    const supabase = getSupabaseClient();

    const { data: admin, error } = await supabase
      .from('admins')
      .select('*')
      .eq('email', email.toLowerCase().trim())
      .maybeSingle();

    if (error) {
      // Graceful fallback to legacy single-user password if migration hasn't been executed
      if (error.code === '42P01') {
        logger.warn('Database "admins" table not found. Falling back to single-user authentication.');
        if (password === ADMIN_PASSWORD) {
          const token = jwt.sign(
            { id: '00000000-0000-0000-0000-000000000000', email: 'legacy-admin@local', role: 'admin' },
            JWT_SECRET,
            { expiresIn: '2h' }
          );
          return res.json({ token });
        }
        return res.status(401).json({ error: 'Invalid credentials.' });
      }
      throw new Error(`Database error: ${error.message}`);
    }

    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const [salt, storedHash] = admin.password_hash.split(':');
    const hash = crypto.pbkdf2Sync(password, salt, 1000, 64, 'sha512').toString('hex');

    if (hash !== storedHash) {
      return res.status(401).json({ error: 'Invalid credentials.' });
    }

    const token = jwt.sign(
      { id: admin.id, email: admin.email, role: 'admin' },
      JWT_SECRET,
      { expiresIn: '2h' }
    );
    logger.info(`Successful login for admin: ${email}`);
    return res.json({ token });
  } catch (error) {
    logger.error('Error in POST /admin/login:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ─── POST /admin/upload ────────────────────────────────────────────────────────
router.post('/admin/upload', authenticateAdmin, upload.single('file'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file provided.' });
  }

  const { tags } = req.body;
  const { originalname: fileName, mimetype: mimeType, buffer: fileBuffer } = req.file;

  try {
    const supabase = getSupabaseClient();
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const storagePath = `${uniqueSuffix}-${sanitizedFileName}`;

    logger.info(`Uploading file ${fileName} to Supabase Storage as ${storagePath}...`);

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('documents')
      .upload(storagePath, fileBuffer, {
        contentType: mimeType,
        upsert: true,
      });

    if (uploadError) {
      throw new Error(`Supabase storage upload failed: ${uploadError.message}`);
    }

    const { data: urlData } = supabase.storage
      .from('documents')
      .getPublicUrl(storagePath);
    
    const publicUrl = urlData.publicUrl;
    logger.info(`File uploaded successfully. Public URL: ${publicUrl}`);

    const extractedText = await parserService.extractText(fileBuffer, mimeType, fileName);
    
    let textToEmbed = `File Name: ${fileName}\n`;
    if (tags) textToEmbed += `Keywords: ${tags}\n`;
    if (extractedText) {
      textToEmbed += `Content Preview:\n${extractedText}`;
    }

    const embedding = await embeddingService.generateEmbedding(textToEmbed);

    const resourceRow = { drive_id: publicUrl, name: fileName, embedding };
    // Tie resource to logged-in admin if ID is not legacy
    if (req.admin && req.admin.id !== '00000000-0000-0000-0000-000000000000') {
      resourceRow.admin_id = req.admin.id;
    }

    const { error: dbError } = await supabase
      .from('resources')
      .insert([resourceRow]);

    if (dbError) {
      await supabase.storage.from('documents').remove([storagePath]).catch(() => {});
      throw new Error(`Supabase DB insert error: ${dbError.message}`);
    }

    matchingService.clearCache();

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
router.post('/request', async (req, res) => {
  try {
    const schema = z.object({
      name: z.string().min(1, 'Name is required').max(100),
      phone: z.string().min(7, 'Phone must be at least 7 digits').max(20),
      query: z.string().min(1, 'Request query is required').max(500),
      adminId: z.string().uuid().optional().or(z.literal('00000000-0000-0000-0000-000000000000')),
    });

    const parseResult = schema.safeParse(req.body);
    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors.map(e => e.message).join(', ');
      return res.status(400).json({ error: errorMsg });
    }

    let { name, phone, query, adminId } = parseResult.data;
    
    name = name.replace(/[\r\n\t]+/g, ' ').trim();
    phone = phone.replace(/[\s\r\n\t]+/g, '').trim();
    query = query.replace(/[\r\n\t]+/g, ' ').trim();

    const normalizedPhone = phone.replace(/[^\d]/g, '');

    logger.info(`Received API request from ${name} (${normalizedPhone}) for admin ${adminId}: "${query}"`);

    // Search resources scoped to the selected admin
    const match = await matchingService.findBestMatch(query, adminId || null);

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
    await whatsapp.sendMessageForAdmin(adminId || null, normalizedPhone, messageText);

    return res.status(200).json({
      message: 'Request processed and WhatsApp message sent successfully.',
      matched_resource: { fileName, drive_id },
    });
  } catch (error) {
    logger.error('Error in POST /request:', error);
    return res.status(500).json({ error: error.message });
  }
});

module.exports = router;
