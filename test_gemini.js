const { GoogleGenerativeAI } = require('@google/generative-ai');
require('dotenv').config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || 'AIzaSyD90Gpr_ZEhGAj_TlNjYVgYQHc3-4abjY8', { apiVersion: 'v1' });

async function run() {
  try {
    console.log('Testing Gemini API key:', process.env.GEMINI_API_KEY || 'AIzaSyD90Gpr_ZEhGAj_TlNjYVgYQHc3-4abjY8');
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await model.embedContent('Hello world');
    console.log('Success! Vector size:', result.embedding.values.length);
  } catch (err) {
    console.error('Error details for text-embedding-004 (v1):', err);
    try {
      const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' });
      // gemini-embedding-001 allows setting outputDimensionality
      const result = await model.embedContent({ content: { parts: [{ text: 'Hello world' }] }, outputDimensionality: 768 });
      console.log('gemini-embedding-001 768 success! Vector size:', result.embedding.values.length);
    } catch (e2) {
      console.error('Error details for gemini-embedding-001 768:', e2);
    }
  }
}

run();
