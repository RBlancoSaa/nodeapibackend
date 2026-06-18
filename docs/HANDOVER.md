# EasyTrip Automator (AL) — Handover & Project Status

> **Last updated:** 2026-06-04
> **Status:** Live op Vercel — elke commit op `main` deployt automatisch.

Dit document is bedoeld zodat een nieuwe AI-sessie of ontwikkelaar binnen ~10
minuten kan oppakken waar de vorige is gestopt. Volledige architectuur +
parser-details staan in `CLAUDE.md`.

---

## 🚨 Regel die ALTIJD geldt: handover bijwerken

**Dit document MOET in elk gesprek actueel gehouden worden. Zodra er iets naar
`main` gaat (elke commit deployt direct via Vercel), wordt EERST hier de uitleg
gegeven — niet achteraf.** Per wijziging:
1. Sessie-sectie bovenaan (`## Sessie YYYY-MM-DD — …`, nieuwste boven): wát er
   veranderde, in welke bestanden, evt. nieuwe env-vars.
2. "Open punten"-lijst bijwerken.
3. "Last updated" bijwerken.

Andere altijd-geldende regels staan in `CLAUDE.md` (rederij uit `rederijen.json`,
nooit data verzinnen, geen auto-create van terminals).

---

## Wat is dit project

Node.js-backend op Vercel die ongelezen Gmail-mails ophaalt, PDF/XLSX-transport­
opdrachten van vaste klanten parseert, `.easy`-XML genereert voor EasyTrip
(MS Access) en die per mail naar `easybestanden@tiarotransport.nl` stuurt.
Trigger: `GET /api/upload-from-inbox`. Pijplijn: classify → handler → parser →
`generateXmlFromJson` → mail. Referentielijsten in Supabase Storage. Zie
`CLAUDE.md` voor de volledige uitleg, klanten/parsers-tabel en regels.

## Sessies

### 2026-06-18 18:30 — Steinweg: groeperen op opzet- ÉN afzet-depot
`handlers/handleSteinweg.js`: de container-groepering (één gezamenlijk `.easy`
per groep, met duplicatienota) keyde voorheen **alleen op het afzet-depot**
(`groepeerOpAfzetdepot`). Nu op het **paar (opzet-depot, afzet-depot)** →
`groepeerOpDepots`. Containers worden alleen samengevoegd als ZOWEL het opzet-
als het afzet-depot gelijk is; gelijk afzet maar ander opzet (of omgekeerd) =
aparte opdracht. Route 1 (vol) en Route 2 (leeg) blijven sowieso gescheiden.

**Bewust NIET aangeraakt:** `parsers/parseSteinweg.js` — hoe Steinweg-mails
geparsed worden en hoe ritten worden opgebouwd blijft ongewijzigd. Alleen de
groepeer-sleutel in de handler is aangepast. Geverifieerd met `node --check` +
losse groepeer-test (zelfde afzet/ander opzet → apart).

### 2026-06-18 17:50 — Jordex-parser: extractie-verbeteringen geport uit AHQ
Achtergrond: de "easy parser dropbox" (`/bedrijf/easy` in Romy-HQ) proxiet naar
`nodeapibackend` `/api/verwerk-pdf-upload` → `handleJordex` → `parseJordex.js`.
Die JS-parser liep achter op de nieuwere TS-versie in AutomatingHQ
(`src/lib/harvester/parsers/jordex.ts`). De **extractie-verbeteringen** zijn
overgenomen; de AHQ-specifieke output-vorm (`referentie` i.p.v. `laadreferentie`,
`containertypeIso`, ISO-datums, `enrich`/`persist`-laag) NIET — die zou de
`.easy`-generatie breken. **AHQ is alleen gelezen, niet gewijzigd.**

Gewijzigd: alleen `parsers/parseJordex.js`. Concreet:
1. Regex-bugfix pickup- én extra-stop-blok: `$` staat nu BUITEn de `\n(...)`-groep.
   Export/reefer-PDF's zonder "Drop-off terminal"-sectie gaven eerder een leeg
   pickup-blok → geen klant/laadlocatie (bv. OE2619362 Champi-Mer BV).
2. Cargo-regel valt terug op álle regels als de pickup-sectie ontbreekt.
3. Carrier & Vessel non-greedy: mail-body zet alles op één regel
   ("Carrier: MAERSK (MAEU) Vessel: TIHAMA ETD: …") → capture stopt nu bij
   Vessel/ETD/2+ spaties i.p.v. de hele regel mee te pakken.
4. `splitInlineAdres()` helper: naam+straat+postcode+plaats op één regel
   (.eml/mail-body) wordt correct gesplitst; PDF-meerregelige variant → null
   (bestaande logica blijft werken). Gebruikt in klant-, extra-stop- en
   terminal-sectie-parsing.
5. "Cut-off" herkend als alias voor "Drop-off terminal" (mail-body).
6. Reply-guard: een body zonder "TRANSPORTATION REQUEST"-kop (bv. een gequote
   RE:/FW:-reply) wordt overgeslagen → geen duplicaat-order uit een quote.

Geen env-/config-/DB-wijziging. Geverifieerd: `node --check` + losse logica-tests
(regex + helper). Geen Jordex-fixture in repo, dus geen end-to-end run.
Open punt: zelfde port-exercitie kan later voor DFDS/Steinweg/Eimskip.

### Sessie 2026-06-04 — handover-document opgezet
- `docs/HANDOVER.md` aangemaakt + handover-regel toegevoegd aan `CLAUDE.md`, zodat
  dit project consistent is met AHQ en Romy-HQ (alle drie houden een handover bij).
- Geen code-/gedragswijziging aan de pijplijn.

## Open punten

(Overgenomen uit de TODO-sectie van `CLAUDE.md` — werk deze lijst bij per sessie.)

1. **KWE-parser** niet geïmplementeerd (stub gooit fout).
2. **Easyfresh-parser** niet geïmplementeerd (stub gooit fout).
3. **DFDS e-mail-body-parser** ontbreekt — DFDS stuurt soms plain-text orders zonder PDF.
4. **Neelevat opdrachtgever** BTW/KVK ontbreken in `parseNeelevat.js`.
5. **Eimskip klanten.json-entry** ontbreekt — opdrachtgever KVK/BTW/adres staat hardcoded in de parser.
6. **Updates** (mail-type) worden overgeslagen, niet verwerkt.
