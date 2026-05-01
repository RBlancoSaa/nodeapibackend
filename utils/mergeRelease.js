// utils/mergeRelease.js
// Vult lege / TBA / "see release" referentievelden aan met data uit een release PDF.

const SEE_RELEASE = /^\s*(TBA|zie\s+release|see\s+release|see\s+pin|zie\s+pin|n\/a|ntb|-)\s*$/i;

/**
 * Verrijkt een geserialiseerd container-object met release-data.
 * Overschrijft alleen lege velden of velden die expliciet verwijzen naar een release.
 *
 * @param {object} container  - Parsed container-data (uit enrichOrder)
 * @param {object} releaseData - { containernummer, referentie, inleverreferentie }
 */
export function mergeRelease(container, releaseData) {
  if (!releaseData) return container;

  const { containernummer, referentie, inleverreferentie } = releaseData;

  // Containernummer: vul aan als ontbreekt
  if (!container.containernummer && containernummer) {
    container.containernummer = containernummer;
    console.log(`📋 mergeRelease: containernummer "${containernummer}" overgenomen uit release`);
  }

  // Opzetreferentie (referentie)
  if (referentie && (!container.referentie || SEE_RELEASE.test(container.referentie))) {
    console.log(`📋 mergeRelease: referentie "${referentie}" overgenomen uit release (was: "${container.referentie}")`);
    container.referentie = referentie;
  }

  // Laadreferentie
  if (referentie && (!container.laadreferentie || SEE_RELEASE.test(container.laadreferentie))) {
    container.laadreferentie = referentie;
  }

  // Afzetreferentie (inleverreferentie)
  if (inleverreferentie && (!container.inleverreferentie || SEE_RELEASE.test(container.inleverreferentie))) {
    console.log(`📋 mergeRelease: inleverreferentie "${inleverreferentie}" overgenomen uit release (was: "${container.inleverreferentie}")`);
    container.inleverreferentie = inleverreferentie;
  }

  return container;
}
