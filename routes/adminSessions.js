const express = require('express');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const sessionManager = require('../services/whatsappSessionManager');
const logger = require('../services/logger');

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'eduhook-default-secret-key-change-in-prod';

// Map to track SSE connections: Map<sessionId, Set<res>>
const sseConnections = new Map();

// Middleware: Authenticate admin via Bearer header or query parameter (for SSE)
function authenticateAdmin(req, res, next) {
  let token;
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    logger.warn('Unauthorized request attempt to session admin endpoint: missing token.');
    return res.status(401).json({ error: 'Access denied. No token provided.' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.admin = decoded;
    next();
  } catch (error) {
    logger.warn('Unauthorized request attempt to session admin endpoint: invalid token.');
    return res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

// Helper to broadcast event to all SSE connections for a sessionId
function broadcastToSession(sessionId, eventName, data) {
  const connections = sseConnections.get(sessionId);
  if (connections && connections.size > 0) {
    const message = `event: ${eventName}\ndata: ${JSON.stringify(data)}\n\n`;
    connections.forEach(res => {
      res.write(message);
    });
  }
}

// Wire up sessionManager events to SSE broadcast
sessionManager.on('session:qr', ({ sessionId, qrDataURL }) => {
  broadcastToSession(sessionId, 'qr', { qrDataURL });
});

sessionManager.on('session:connected', ({ sessionId, phone, connectedAt }) => {
  broadcastToSession(sessionId, 'connected', { phone, connectedAt });
});

sessionManager.on('session:disconnected', ({ sessionId, statusCode }) => {
  broadcastToSession(sessionId, 'disconnected', { statusCode });
});

sessionManager.on('session:removed', ({ sessionId }) => {
  broadcastToSession(sessionId, 'removed', { sessionId });
});

/**
 * GET /admin/sessions
 * Returns lists of all active sessions.
 */
router.get('/sessions', authenticateAdmin, (req, res) => {
  try {
    const list = sessionManager.listSessions();
    res.json(list);
  } catch (err) {
    logger.error('Error listing sessions:', err);
    res.status(500).json({ error: 'Failed to list sessions' });
  }
});

/**
 * POST /admin/sessions
 * Creates a new session.
 */
router.post('/sessions', authenticateAdmin, async (req, res) => {
  try {
    let { sessionId } = req.body;
    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim() === '') {
      sessionId = crypto.randomBytes(4).toString('hex'); // 8 hex chars
    } else {
      sessionId = sessionId.trim().replace(/[^a-zA-Z0-9_-]/g, '');
    }

    const sessionObj = await sessionManager.createSession(sessionId);
    res.json({
      sessionId,
      eventsUrl: `/admin/sessions/${sessionId}/events`
    });
  } catch (err) {
    logger.error('Error creating session:', err);
    res.status(500).json({ error: 'Failed to create session' });
  }
});

/**
 * GET /admin/sessions/:id/events
 * SSE stream to receive live session updates (QR codes, connection state).
 */
router.get('/sessions/:id/events', authenticateAdmin, (req, res) => {
  const sessionId = req.params.id;

  const session = sessionManager.getSession(sessionId);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  // Set SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no' // Prevent Nginx buffer buffering SSE
  });

  // Write immediate state reply
  res.write(`: open connection\n\n`);
  
  if (session.status === 'connected') {
    res.write(`event: connected\ndata: ${JSON.stringify({ phone: session.phone, connectedAt: session.connectedAt })}\n\n`);
  } else if (session.status === 'qr_pending' && session.qrDataURL) {
    res.write(`event: qr\ndata: ${JSON.stringify({ qrDataURL: session.qrDataURL })}\n\n`);
  } else {
    res.write(`event: state\ndata: ${JSON.stringify({ status: session.status })}\n\n`);
  }

  // Register connection
  if (!sseConnections.has(sessionId)) {
    sseConnections.set(sessionId, new Set());
  }
  sseConnections.get(sessionId).add(res);

  // Keep-alive heartbeat (25s ping)
  const heartbeat = setInterval(() => {
    res.write(':ping\n\n');
  }, 25000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const connections = sseConnections.get(sessionId);
    if (connections) {
      connections.delete(res);
      if (connections.size === 0) {
        sseConnections.delete(sessionId);
      }
    }
  });
});

/**
 * DELETE /admin/sessions/:id
 * Disconnects and deletes a session.
 */
router.delete('/sessions/:id', authenticateAdmin, async (req, res) => {
  try {
    const sessionId = req.params.id;
    const session = sessionManager.getSession(sessionId);
    if (!session) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await sessionManager.removeSession(sessionId);
    res.json({ success: true, message: `Session ${sessionId} removed.` });
  } catch (err) {
    logger.error(`Error deleting session ${req.params.id}:`, err);
    res.status(500).json({ error: 'Failed to delete session' });
  }
});

module.exports = router;
