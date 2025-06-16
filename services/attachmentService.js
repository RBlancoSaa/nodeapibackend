// 📁 automatinglogistics-api/services/attachmentService.js

export async function findAttachmentsAndUpload(client, uids, supabase) {
  const mails = [];
  const uploadedFiles = [];

  for await (const message of client.fetch(uids, { envelope: true, bodyStructure: true })) {
    const attachments = [];

    function findAllAttachments(structure) {
      if (
        structure.disposition?.type?.toUpperCase() === 'ATTACHMENT' &&
        structure.part && structure.subtype && structure.type
      ) {
        attachments.push({
          part: structure.part,
          contentType: `${structure.type}/${structure.subtype}`,
          filename: structure.params?.name || `attachment-${structure.part}`
        });
      }
      if (structure.childNodes) structure.childNodes.forEach(findAllAttachments);
      if (structure.parts) structure.parts.forEach(findAllAttachments);
    }

    if (message.bodyStructure) findAllAttachments(message.bodyStructure);

    mails.push({
      uid: message.uid,
      subject: message.envelope.subject || '(geen onderwerp)',
      from: message.envelope.from.map(f => `${f.name ?? ''} <${f.address}>`.trim()).join(', '),
      date: message.envelope.date,
      attachments: attachments.map(att => ({ part: att.part, contentType: att.contentType, filename: att.filename }))
    });

    for (const att of attachments) {
      const content = await client.download(message.uid, att.part);

      const { error } = await supabase.storage
        .from('inboxpdf')
        .upload(att.filename, content, {
          contentType: att.contentType,
          cacheControl: '3600',
          upsert: true,
        });

      if (error) {
        console.error('Uploadfout:', error.message);
      } else {
        uploadedFiles.push({
          filename: att.filename,
          url: `${process.env.SUPABASE_URL}/storage/v1/object/public/inboxpdf/${att.filename}`
        });
      }
    }
  }

  return { mails, uploadedFiles };
}
