export default async function parseKWE(buffer, alias) {
  return {
    klantnaam: alias,
    melding: `Parser voor ${alias} is nog niet geïmplementeerd`,
    locaties: [],
    containertype: '0'
  };
}