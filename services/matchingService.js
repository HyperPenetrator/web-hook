/**
 * matchingService.js
 *
 * Shared resource-matching logic used by both:
 *  - the WhatsApp bot (incoming message handler in whatsappService.js)
 *  - the HTTP API route (POST /api/request)
 *
 * Exports:
 *   findBestMatch(query) → { fileName, drive_id } | null
 */

const { getSupabaseClient } = require('./supabaseClient');
const embeddingService = require('./embeddingService');
const logger = require('./logger');
require('dotenv').config();

// Cache object to store query matches (key: query.toLowerCase().trim(), value: match)
const queryCache = new Map();
const CACHE_MAX_SIZE = 100;

/**
 * Converts a free-text query into a vector embedding, then runs a cosine-
 * similarity search against the `resources` table via the `match_resources` RPC.
 *
 * @param {string} query  - The user's natural-language request.
 * @param {number} [threshold=0.7] - Minimum similarity score (0–1).
 * @param {number} [count=1]       - Max number of results to return.
 * @returns {Promise<{ fileName: string, drive_id: string } | null>}
 *   The best matching resource, or null if nothing is above the threshold.
 */
async function findBestMatch(query, threshold = 0.6, count = 1) {
  const cacheKey = (query || '').toLowerCase().trim();
  
  if (queryCache.has(cacheKey)) {
    return queryCache.get(cacheKey);
  }

  // 1. Embed the query
  const queryEmbedding = await embeddingService.generateEmbedding(query);

  // 2. Run pgvector similarity search with 0.0 threshold
  const supabase = getSupabaseClient();
  const { data: matches, error } = await supabase.rpc('match_resources', {
    query_embedding: queryEmbedding,
    match_threshold: 0.0,
    match_count: 5,
  });

  if (error) {
    throw new Error(`Supabase RPC error: ${error.message}`);
  }

  if (matches) {
    logger.info(`Database match query raw similarity scores: ${JSON.stringify(matches.map(m => ({ name: m.name, similarity: m.similarity })))}`);
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

  // Manage cache size
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
