// File: api/upload-pdf-attachments.js

import formidable from 'formidable';
import { parseAttachments } from '../../services/parseAttachments';
import { uploadPdfAttachmentsToSupabase } from '../../services/uploadPdfAttachmentsToSupabase';

// Zet Vercel API in “raw body” modus
export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  // Parse multipart/form-data
  const form = new formidable.IncomingForm();
  form.parse(req, async (err, fields, files) => {
    if (err) {
      console.error('Error parsing form:', err);
      return res.status(500).json({ error: 'Form parsing error' });
    }

    // parseAttachments kan opschonen & normaliseren naar { filename, mimeType, buffer }
    const attachments = parseAttachments(files);

    // Filter enkel PDF’s
    const pdfs = attachments.filter(
      att =>
        att.mimeType === 'application/pdf' ||
        att.filename.toLowerCase().endsWith('.pdf')
    );

    if (!pdfs.length) {
      return res.status(400).json({ error: 'No PDF attachments found' });
    }

    try {
      // uploadPdfAttachmentsToSupabase handelt per PDF het uploaden af
      const uploadResults = await uploadPdfAttachmentsToSupabase(pdfs);
      return res.status(200).json({ uploaded: uploadResults });
    } catch (uploadErr) {
      console.error('Upload error:', uploadErr);
      return res.status(500).json({ error: 'Failed to upload PDFs' });
    }
  });
}
