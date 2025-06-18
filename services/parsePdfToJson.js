import pdf from 'pdf-parse';

export async function parsePdf(buffer) {
  try {
    const data = await pdf(buffer);
    return data.text;
  } catch (err) {
    console.error('Fout bij PDF parse:', err.message);
    return null;
  }
}
