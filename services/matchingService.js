/**
 * matchingService.js
 *
 * Shared resource-matching logic used by both:
 *  - the WhatsApp bot (incoming message handler in whatsappSessionManager.js)
 *  - the HTTP API route (POST /api/request)
 *
 * Exports:
 *   findBestMatch(query, adminId) → { fileName, drive_id } | null
 */

const { getSupabaseClient } = require('./supabaseClient');
const embeddingService = require('./embeddingService');
const logger = require('./logger');
require('dotenv').config();

// Cache object to store query matches (key: adminId_query, value: match)
const queryCache = new Map();
const CACHE_MAX_SIZE = 100;

/**
 * Converts a free-text query into a vector embedding, then runs a cosine-
 * similarity search against the `resources` table via pgvector.
 * Supports multi-admin isolation by filtering on adminId if provided.
 *
 * @param {string} query  - The user's natural-language request.
 * @param {string|null} [adminId=null] - The ID of the admin session for scoping search.
 * @param {number} [threshold=0.55] - Minimum similarity score (0–1).
 * @param {number} [count=1]       - Max number of results to return.
 * @returns {Promise<{ fileName: string, drive_id: string } | null>}
 *   The best matching resource, or null if nothing is above the threshold.
 */
async function findBestMatch(query, adminId = null, threshold = 0.55, count = 1) {
  // Translate legacy default UUID to null for global search fallback
  const effectiveAdminId = (adminId === '00000000-0000-0000-0000-000000000000') ? null : adminId;

  // Build secure composite cache key to isolate caching per admin
  const cacheKey = `${effectiveAdminId || 'all'}_${(query || '').toLowerCase().trim()}`;
  
  if (queryCache.has(cacheKey)) {
    return queryCache.get(cacheKey);
  }

  // 1. Embed the query
  const queryEmbedding = await embeddingService.generateEmbedding(query);

  // 2. Run pgvector similarity search
  const supabase = getSupabaseClient();
  let matches = null;
  let error = null;

  // Try calling the new match_resources_v2 function first
  try {
    const res = await supabase.rpc('match_resources_v2', {
      query_embedding: queryEmbedding,
      match_threshold: 0.0,
      match_count: 5,
      p_admin_id: effectiveAdminId,
    });
    matches = res.data;
    error = res.error;
  } catch (err) {
    logger.warn('Error invoking match_resources_v2 RPC, will attempt fallback:', err);
  }

  // Fallback to legacy function if v2 function is missing or returns error code
  if (error || !matches) {
    logger.info('Falling back to legacy match_resources function (no admin-scoping)...');
    const res = await supabase.rpc('match_resources', {
      query_embedding: queryEmbedding,
      match_threshold: 0.0,
      match_count: 5,
    });
    matches = res.data;
    error = res.error;

    if (error) {
      throw new Error(`Legacy match_resources RPC failed: ${error.message}`);
    }
  }

  if (matches) {
    logger.info(`Similarity scores [admin:${effectiveAdminId || 'all'}]: ${JSON.stringify(matches.map(m => ({ name: m.name, similarity: m.similarity })))}`);
  }

  let result = null;
  if (matches && matches.length > 0) {
    const best = matches[0];
    if (best.similarity >= threshold) {
      result = {
        fileName: best.name,
        drive_id: best.drive_id,
      };
    } else {
      logger.info(`Best match "${best.name}" similarity (${best.similarity}) was below threshold (${threshold})`);
    }
  }

  // Manage cache size limits
  if (queryCache.size >= CACHE_MAX_SIZE) {
    const firstKey = queryCache.keys().next().value;
    queryCache.delete(firstKey);
  }
  queryCache.set(cacheKey, result);

  return result;
}

function clearCache() {
  queryCache.clear();
  logger.info('Query match cache cleared.');
}

module.exports = { findBestMatch, clearCache };
