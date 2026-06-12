const { google } = require('googleapis');
const fs = require('fs');

// Initialize Google Auth using local credentials file
const auth = new google.auth.GoogleAuth({
  keyFile: 'google-credentials.json',
  scopes: ['https://www.googleapis.com/auth/drive.file'],
});

const drive = google.drive({ version: 'v3', auth });

/**
 * Uploads a file to Google Drive.
 * @param {string} filePath - Local path to the file.
 * @param {string} fileName - Name of the file to save in Drive.
 * @param {string} mimeType - MIME type of the file.
 * @returns {Promise<string>} The Google Drive file ID.
 */
async function uploadToDrive(filePath, fileName, mimeType) {
  try {
    const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
    if (!folderId) {
        throw new Error('GOOGLE_DRIVE_FOLDER_ID environment variable is missing.');
    }

    const fileMetadata = {
      name: fileName,
      parents: [folderId],
    };

    const media = {
      mimeType: mimeType,
      body: fs.createReadStream(filePath),
    };

    const file = await drive.files.create({
      resource: fileMetadata,
      media: media,
      fields: 'id',
      supportsAllDrives: true,
    });

    return file.data.id;
  } catch (error) {
    console.error('Error uploading file to Google Drive:', error);
    throw error;
  }
}

module.exports = {
  uploadToDrive,
};
