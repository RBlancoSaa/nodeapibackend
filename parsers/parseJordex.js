export default async function parseJordex(pdfBuffer) {
  try {
    const { default: pdfParse } = await import('pdf-parse');
    const parsed = await pdfParse(pdfBuffer);
    const text = parsed.text;

    return {
      opdrachtgeverNaam: (text.match(/Opdrachtgever:\s*(.*)/i) || [])[1] || '',
      referentie: (text.match(/Our reference:\s*(\S+)/i) || [])[1] || '',
      bootnaam: (text.match(/Vessel:\s*(.*)/i) || [])[1] || '',
      rederij: (text.match(/Carrier:\s*(.*)/i) || [])[1] || '',
      containertype: (text.match(/(\d{2})['’]?\s+high\s+cube\s+reefer/i) || [])[0] || '',
      temperatuur: (text.match(/Temperature:\s*(-?\d+)[°º]C/i) || [])[1] || ''
    };

  } catch (err) {
    console.error('❌ Fout in parseJordex:', err.message);
    throw err;
  }
}