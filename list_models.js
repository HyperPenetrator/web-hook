const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'AIzaSyD90Gpr_ZEhGAj_TlNjYVgYQHc3-4abjY8');

async function run() {
  try {
    // Note: the JS SDK doesn't have a direct listModels, but we can do a fetch
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${process.env.GEMINI_API_KEY || 'AIzaSyD90Gpr_ZEhGAj_TlNjYVgYQHc3-4abjY8'}`);
    const data = await response.json();
    console.log('Available models:');
    if (data.models) {
      data.models.forEach(m => {
        if (m.supportedGenerationMethods.includes('embedContent') || m.name.includes('embed')) {
          console.log(`- ${m.name} (${m.displayName}) methods: ${m.supportedGenerationMethods.join(', ')}`);
        }
      });
    } else {
      console.log('No models returned. Response:', data);
    }
  } catch (err) {
    console.error(err);
  }
}

run();
