const { GoogleGenerativeAI } = require('@google/generative-ai');
const { pipeline } = require('@xenova/transformers');
const logger = require('./logger');
require('dotenv').config();

let extractor = null;
let genAI = null;

// Initialize Gemini API if key is present
if (process.env.GEMINI_API_KEY) {
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
}

/**
 * Generates a 768-dimensional vector embedding for the input text.
 * Uses the Google Gemini API (text-embedding-004) by default,
 * and falls back to local Xenova/all-mpnet-base-v2 if API fails.
 * 
 * @param {string} text - The raw text to embed.
 * @returns {Promise<number[]>} 768-dimensional array of floats.
 */
async function generateEmbedding(text) {
  // Truncate text if it's exceptionally long to protect embedding endpoints.
  // Gemini text-embedding-004 supports 2048 tokens. 1 token ~= 4 characters.
  // Truncating text to 8000 characters is a safe and high-fidelity limit.
  const cleanText = (text || '').substring(0, 8000).trim();
  if (!cleanText) {
    logger.warn('Empty text received for embedding generation. Using default fallback input.');
  }

  // 1. Try Gemini API
  if (genAI) {
    try {
      logger.info('Generating embedding using Gemini API (text-embedding-004)...');
      const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
      const response = await model.embedContent(cleanText || 'empty document');
      if (response && response.embedding && response.embedding.values) {
        logger.debug('Successfully generated embedding using Gemini.');
        return response.embedding.values;
      }
      throw new Error('Invalid response payload from Gemini embedding API');
    } catch (error) {
      logger.alert('Gemini embedding generation failed. Falling back to local Xenova model.', error);
    }
  } else {
    logger.warn('GEMINI_API_KEY is not defined. Using local Xenova model directly.');
  }

  // 2. Local Fallback (Xenova transformers all-mpnet-base-v2)
  try {
    logger.info('Generating embedding using local Xenova/all-mpnet-base-v2...');
    if (!extractor) {
      extractor = await pipeline('feature-extraction', 'Xenova/all-mpnet-base-v2', { quantized: true });
    }
    const output = await extractor(cleanText || 'empty document', { pooling: 'mean', normalize: true });
    logger.debug('Successfully generated embedding using Xenova.');
    return Array.from(output.data);
  } catch (error) {
    logger.error('Critical failure in local Xenova embedding generation fallback:', error);
    throw error;
  }
}

module.exports = {
  generateEmbedding,
};
