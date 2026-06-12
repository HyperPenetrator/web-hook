const { createClient } = require('@supabase/supabase-js');
const logger = require('./logger');

let supabase = null;

/**
 * Lazily retrieves the Supabase client instance.
 * Prevents application startup crashes if environment variables are missing initially.
 * 
 * @returns {import('@supabase/supabase-js').SupabaseClient}
 */
function getSupabaseClient() {
  if (!supabase) {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_ANON_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Supabase configuration is missing. Please ensure SUPABASE_URL and SUPABASE_ANON_KEY are set.');
    }

    logger.info('Initializing Supabase client...');
    supabase = createClient(supabaseUrl, supabaseKey);
  }
  return supabase;
}

module.exports = {
  getSupabaseClient,
};
