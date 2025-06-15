export function findPDFs(structure, pdfParts = []) {
  if (!structure) return pdfParts;
  const dispositionType = structure.disposition?.type?.toUpperCase() || '';
  const isPdf =
    structure.type === 'application' &&
    structure.subtype?.toLowerCase() === 'pdf' &&
    (dispositionType === 'ATTACHMENT' || dispositionType === 'INLINE' || dispositionType === '');

  if (isPdf) {
    pdfParts.push(structure.part);
  }
  if (structure.childNodes) structure.childNodes.forEach(child => findPDFs(child, pdfParts));
  if (structure.parts) structure.parts.forEach(part => findPDFs(part, pdfParts));
  return pdfParts;
}