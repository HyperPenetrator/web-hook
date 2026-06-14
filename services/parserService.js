const pdfParse = require('pdf-parse');
const mammoth = require('mammoth');
const logger = require('./logger');

/**
 * Extracts raw text from document file buffers based on MIME type.
 * Supports PDF, DOCX, and TXT.
 * 
 * @param {Buffer} fileBuffer - The file content buffer from multer memoryStorage.
 * @param {string} mimeType - The file's MIME type.
 * @param {string} fileName - The file's original name.
 * @returns {Promise<string>} The extracted text. Returns empty string if unsupported or failed.
 */
async function extractText(fileBuffer, mimeType, fileName) {
  try {
    if (mimeType === 'text/plain') {
      logger.info(`Extracting plain text from ${fileName}`);
      return fileBuffer.toString('utf8');
    }

    if (mimeType === 'application/pdf') {
      logger.info(`Extracting text from PDF file: ${fileName}`);
      let pdfData;
      if (typeof pdfParse === 'function') {
        pdfData = await pdfParse(fileBuffer);
      } else if (pdfParse && typeof pdfParse.PDFParse === 'function') {
        pdfData = await pdfParse.PDFParse(fileBuffer);
      } else {
        throw new Error('pdf-parse package format unsupported (no function or PDFParse method found)');
      }
      return pdfData.text || '';
    }

    if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/msword'
    ) {
      logger.info(`Extracting text from Word document: ${fileName}`);
      const result = await mammoth.extractRawText({ buffer: fileBuffer });
      return result.value || '';
    }

    logger.warn(`Text extraction not supported for MIME type: ${mimeType} (${fileName})`);
    return '';
  } catch (error) {
    logger.error(`Failed to extract text from document ${fileName} of type ${mimeType}`, error);
    return '';
  }
}

module.exports = {
  extractText,
};
