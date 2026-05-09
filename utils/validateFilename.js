// utils/validateFilename.js
// Voorkomt path traversal en injection bij Supabase Storage downloads/uploads.
// Sta alleen letters, cijfers, underscore, dash, punt en spatie toe. Geen ".." of "/".

export function validateFilename(name) {
  if (typeof name !== 'string' || !name.length) {
    throw new Error('Ongeldige bestandsnaam');
  }
  if (name.length > 255) {
    throw new Error('Bestandsnaam te lang');
  }
  if (name.includes('..') || name.includes('/') || name.includes('\\') || name.includes('\0')) {
    throw new Error('Bestandsnaam bevat verboden tekens');
  }
  if (!/^[A-Za-z0-9._\- ]+$/.test(name)) {
    throw new Error('Bestandsnaam bevat ongeldige tekens');
  }
  return name;
}

// Variant die een Supabase storage-pad accepteert: subfolder/bestand.pdf.
// Sta één laag toe (geen .. en geen absolute paden).
export function validateStoragePath(path) {
  if (typeof path !== 'string' || !path.length) {
    throw new Error('Ongeldig pad');
  }
  if (path.length > 512) {
    throw new Error('Pad te lang');
  }
  if (path.includes('..') || path.includes('\\') || path.includes('\0') || path.startsWith('/')) {
    throw new Error('Pad bevat verboden tekens');
  }
  if (!/^[A-Za-z0-9._\-/ ]+$/.test(path)) {
    throw new Error('Pad bevat ongeldige tekens');
  }
  return path;
}
