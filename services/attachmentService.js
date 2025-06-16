// 📁 services/attachmentService.js

export async function findAttachments(structure, client, uid, attachments = []) {
  if (!structure) return attachments;

  const disposition = structure.disposition?.type?.toUpperCase() || '';
  const isAttachment = disposition === 'ATTACHMENT' || disposition === 'INLINE' || disposition === '';

  const filename =
    structure.disposition?.params?.filename ||
    structure.params?.name ||
    `attachment-${uid}-${structure.part.replace(/\s+/g, '_')}`;

  const isDownloadable = structure.part && structure.size > 0 && isAttachment;

  if (isDownloadable) {
    try {
      const download = await client.download(uid, structure.part);
      const chunks = [];
      for await (const chunk of download.content) {
        chunks.push(chunk);
      }

      attachments.push({
        part: filename,
        buffer: Buffer.concat(chunks),
        contentType: structure.type + '/' + structure.subtype,
      });
    } catch (error) {
      console.error(`❌ Fout bij downloaden bijlage ${filename}:`, error.message);
    }
  }

  if (structure.childNodes) {
    for (const child of structure.childNodes) {
      await findAttachments(child, client, uid, attachments);
    }
  }

  if (structure.parts) {
    for (const part of structure.parts) {
      await findAttachments(part, client, uid, attachments);
    }
  }

  return attachments;
}
