export default async function parseDFDS(buffer, alias) {
  return {
    klantnaam: alias,
    melding: `Parser voor ${alias} is nog niet geïmplementeerd`,
    locaties: [],
    containertype: '0'
  };
}