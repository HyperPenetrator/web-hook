if (typeof globalThis.WebSocket === 'undefined') {
  globalThis.WebSocket = require('ws');
}

const { getSupabaseClient } = require('./services/supabaseClient');
const embeddingService = require('./services/embeddingService');
const parserService = require('./services/parserService');
const logger = require('./services/logger');
require('dotenv').config();

const MIME_MAP = {
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.txt': 'text/plain',
};

async function reindex() {
  // Check if we are running in an environment where we can load supabase client
  let supabase;
  try {
    supabase = getSupabaseClient();
  } catch (err) {
    logger.error('Failed to init Supabase client. Set credentials in environment.', err);
    process.exit(1);
  }

  logger.info('Fetching resources from database for re-indexing...');
  
  const { data: resources, error } = await supabase.from('resources').select('id, name, drive_id');
  if (error) {
    logger.error('Failed to fetch resources:', error);
    process.exit(1);
  }

  logger.info(`Found ${resources.length} resources to re-index.`);

  for (const res of resources) {
    try {
      logger.info(`Processing "${res.name}" (ID: ${res.id})...`);
      
      // 1. Download file from public URL
      const response = await fetch(res.drive_id);
      if (!response.ok) {
        throw new Error(`Failed to download file: ${response.statusText}`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 2. Determine MIME type
      const ext = res.name.substring(res.name.lastIndexOf('.')).toLowerCase();
      const mimeType = MIME_MAP[ext] || 'application/octet-stream';

      // 3. Extract text
      const extractedText = await parserService.extractText(buffer, mimeType, res.name);

      // 4. Construct embedding payload
      let textToEmbed = `File Name: ${res.name}\n`;
      if (extractedText) {
        textToEmbed += `Content Preview:\n${extractedText}`;
      }

      // 5. Generate new Gemini embedding
      const embedding = await embeddingService.generateEmbedding(textToEmbed);

      // 6. Update row in database
      const { error: updateError } = await supabase
        .from('resources')
        .update({ embedding })
        .eq('id', res.id);

      if (updateError) {
        throw new Error(`Failed to update DB: ${updateError.message}`);
      }

      logger.info(`Successfully re-indexed "${res.name}"`);
    } catch (err) {
      logger.error(`Error re-indexing resource "${res.name}":`, err);
    }
  }

  logger.info('Re-indexing process complete.');
}

reindex();
