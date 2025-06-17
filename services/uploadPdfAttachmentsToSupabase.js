export async function uploadPdfAttachmentsToSupabase(attachments) {
  const uploadedFiles = [];

  const sanitizedAttachments = attachments.map(att => ({
    ...att,
    originalFilename: att.filename,
    filename: att.filename
      .normalize('NFKD')
      .replace(/[^\w\d\-_.]/g, '_')
      .replace(/_+/g, '_')
  }));

  for (const att of sanitizedAttachments) {
    if (!att.filename?.toLowerCase().endsWith('.pdf')) {
      console.log(`⏭️ Bestand overgeslagen (geen .pdf): ${att.filename}`);
      continue;
    }

    // ⛔️ safeFilename is overbodig — att.filename is al sanitized
    // const safeFilename = ...  ← WEGLATEN

    let contentBuffer;
    try {
      if (Buffer.isBuffer(att.content)) {
        contentBuffer = att.content;
      } else if (att.content instanceof Uint8Array) {
        contentBuffer = Buffer.from(att.content);
      } else if (att.content instanceof ArrayBuffer) {
        contentBuffer = Buffer.from(new Uint8Array(att.content));
      } else {
        throw new Error('Attachment content is not een buffer');
      }
    } catch (err) {
      console.error(`❌ Buffer error (${att.filename}):`, err.message);
      continue;
    }

    if (!contentBuffer?.length) {
      console.error(`⛔ Lege buffer voor ${att.filename}`);
      continue;
    }

    // En gebruik att.filename hier:
    const { error } = await supabase.storage
      .from(process.env.SUPABASE_BUCKET)
      .upload(att.filename, contentBuffer, {
        contentType: att.contentType || 'application/pdf',
        cacheControl: '3600',
        upsert: true,
      });

    if (error) {
      console.error(`❌ Uploadfout: Invalid key: ${att.filename}`);
      continue;
    }

    console.log(`✅ Upload gelukt: ${att.filename}`);

    // ✅ Daarna: verder met parsing en upload zoals eerder
  }

  return uploadedFiles;
}
