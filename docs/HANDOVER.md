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

### 2026-06-18 22:45 — Steinweg-diesel als percentage + bulk-tarief-wijzigen in dashboard
Twee dingen:
1. **Steinweg diesel** (`utils/steinwegTarieven.js`): `dieselToeslagChart` gaf een
   €-BEDRAG terug (9% × basistarief, bv. €13,50), terwijl EasyTrip in
   `<Diesel_toeslag_Chart>` een PERCENTAGE verwacht (zoals alle andere klanten via
   `enrichOrder`). Steinweg sloeg `enrichOrder`'s toeslagen-blok over (want het zet
   `adrBedragChart` zelf → guard op regel ~211 in enrichOrder), dus het €-bedrag
   bleef staan. Nu geeft `berekenVolTarief`/`berekenLeegTarief` het **percentage**
   (`dieselPct`) terug. (13,5 die de gebruiker zag = €13,50 = 9% van het tarief,
   géén losse prijsafspraak — staat nergens in nodeapi/AHQ als 13,5%.)
2. **Bulk-tarief wijzigen** (`api/dashboard.js`, tarieven-grid): de bulk-balk kon
   alleen "verbergen". Toegevoegd: kolom-select (tarief/diesel/delta/…) + waarde +
   knop **"Toepassen op selectie"** → zet die kolom op dezelfde waarde voor alle
   aangevinkte klanten via het bestaande `/api/prijsafspraken`-endpoint
   (`tgBulkSet`). All-in-rijen slaan terminal-toeslagen over.
`node --check` groen.

### 2026-06-18 22:10 — KWE: echte parser (`parsers/parseKWE.js`) + AHQ-verbeteringen
`parsers/parseKWE.js` was een stub (lege `.easy` in de dropbox). De volledige
KWE-extractie zat al inline in `handlers/handleKWE.js` (Gmail-flow werkte dus
al); die logica is nu naar `parseKWE.js` verplaatst én verbeterd met de
AHQ-port (`kwe.ts`):
- **conversatie/reply-guard**: body zonder order-marker maar mét vraag/reply-
  markers → geen (spook)order;
- **subject-route fallback** ("Transportopdracht Rotterdam - Plaats / …");
- **alternatief body-formaat** ("Laden:", "LEVEREN:", containerregel
  "KOCU4597056// A264031605 // 04-06-2026 om 13.00U", "Leeg retour RWG",
  Turn-In-Ref → inleverreferentie, pin → referentie);
- **containernr uit release-PDF** (best-effort) + **rederij uit container-prefix**
  (BIC owner code; enrichOrder valideert via rederijen-lijst).
`handleKWE.js` is nu een dunne wrapper (parse → .easy → mail → log).
`parsePdfToJson` KWE-route geeft de PDF-tekst als body mee (dropbox) en is
genormaliseerd (Array.isArray). nodeapi-vorm behouden (DD-MM-YYYY,
opdrachtgeverBTW/KVK, inleverreferentie, _noTerminalLookup) → opdrachten_log-
sync naar AHQ blijft intact. `node --check` + losse extractie-test (alt-formaat).
NB: KWE is body-based; een losse release-PDF in de dropbox levert weinig — de
echte bron is de e-mail (Gmail-flow of een .eml met body).

### 2026-06-18 21:40 — B2L + Ritra: gerichte extractie-verbeteringen uit AHQ
Na een parser-voor-parser vergelijking met de AHQ-versies (b2l/neelevat/ritra/
steder.ts) twee echte verbeteringen geport (rest is gelijkwaardig — zie onder):
- **B2L** (`parsers/parseB2L.js`): bij RIDER-PDF's is "CARGO DESCRIPTION" een
  kolom-kop i.p.v. een label → `valAfterLabel` pakte de kop-rest ("Packages
  Gross Weight Volume") als lading. Nu: als de lading leeg is of naar die
  kop-tekst ruikt, wordt de echte omschrijving uit de eerste RIDER-datarij
  gehaald (na container+zegel, vóór de gewicht/volume-regel). `const lading`
  → `let lading`.
- **Ritra** (`parsers/parseRitra.js`): containertype ondersteunt nu 45ft +
  45ft HC + 20ft HC (voorheen viel alles ≠ 40ft terug op kaal "{size}ft").

**Geen verandering nodig voor Neelevat en Steder**: AHQ's versies hebben
identieke extractie-logica (zelfde regexes/velden) — bevestigd, nodeapi is hier
niet achtergelopen. ISO-datum/number-types uit AHQ bewust NIET overgenomen:
nodeapi moet `DD-MM-YYYY` houden, anders breekt AHQ's opdrachten_log-sync
(`parseDate` verwacht dat formaat). Geverifieerd met `node --check` + losse
extractie-tests.

### 2026-06-18 20:30 — Easyfresh parser geïmplementeerd (stub → echt, geport uit AHQ)
`parsers/parseEasyfresh.js` was een stub (gaf leeg object → lege `.easy`
"Order_GeenReferentie_Onbekend"). Nu een echte parser, geport uit AHQ
`easyfresh.ts`, aangepast aan nodeapi-vorm (enrichOrder, `DD-MM-YYYY`,
nodeapi-veldnamen). Verwerkt het Easyfresh-formaat: header
"Opdrachtbevestiging EFN..", "Vracht"-regel (lading+temperatuur),
"Cont. vol uithal." (opzet+container+boot/rederij) en "Container vol
inleveren" (afzet+ref). Terminal→terminal import-flow. Fallback bij
ontbrekende uithaal-regel: minimale order + ruwe tekst in instructies.
`parsePdfToJson` Easyfresh-route ook genormaliseerd (Array.isArray).

FIX (20:55): getest tegen een echte Easyfresh-PDF ("Magazijn - Proforma Zending
Leverancier_L04764", EFN26-06-0364). De activiteit-marker bleek **"Container vol
uithal."** i.p.v. de "Cont. vol uithal." uit AHQ → regex aangepast naar
`/Cont(?:ainer)?\.?\s+vol\s+uithal\.?/i`. Nu worden ref, datum, lading+temp,
opzet-terminal, container, boot/rederij, afzet-locatie en afzet-ref allemaal
correct geëxtraheerd. ("L04764" in de bestandsnaam is een intern report-nr; de
echte ref EFN26-06-0364 staat in de PDF-tekst.)

### 2026-06-18 20:05 — Dropbox: double-wrap-bug B2L/Neelevat/Ritra/Steder gefixt
`services/parsePdfToJson.js` (gebruikt door de Romy-HQ "easy"-dropbox via
`/api/verwerk-pdf-upload`). parseB2L/parseNeelevat/parseRitra/parseSteder geven
zelf al een **array** terug, maar parsePdfToJson wrapte ze als `[await parseX()]`
→ `[[...]]` (dubbel genest). De dropbox pakte dan de binnenste array als
"container" → `generateXmlFromJson` las `data.locaties[0]` op een array →
`Cannot read properties of undefined (reading '0')` (B2L gaf "Geen enkele PDF
kon verwerkt worden"). Nu net als Jordex/DFDS:
`const r = await parseX(); return Array.isArray(r) ? r : [r];`. Alleen in de
dropbox-flow stuk geweest; de Gmail-handlers riepen de parsers al correct aan.

### 2026-06-18 19:10 — DFDS: meerdere transport-blokken + lithium-ADR (geport uit AHQ)
`parsers/parseDFDS.js` + `handlers/handleDFDS.js`. Geport uit AHQ's `dfds.ts`,
maar **alleen de library-onafhankelijke extractie-winst** — nodeapi's `pdf2json`
(kolommen mét spaties) en veldvorm blijven intact. AHQ-only spul (pdf-parse-
spatieloze regexes, `containerTypeNaarIso`, eigen types, `ctx.allPdfs`) NIET
overgenomen; multi-PDF + body-only-order zaten al in `handleDFDS`.

1. **Meerdere transport-blokken**: een DFDS-order kan >1 tabel-header hebben, elk
   met eigen container-set én eigen afzet-depot (blok 1 → Medrepair, blok 2 →
   ECT Delta). Voorheen las de parser alleen het EERSTE blok → containers van
   blok 2+ bleven leeg. Nu loopt hij over álle headers; elke container krijgt de
   locaties van zijn eigen blok.
2. **Lithium → ADR klasse 9 veiligheidsnet**: lithium(-ion, incl. DFDS-typo
   "li-ino") = altijd ADR, ook zonder expliciete markering (AHQ-les SFIM2600869).
   In de parser (PDF-tekst) én in `handleDFDS` (email-body override + body-only).
3. Preciezere ADR: `Dangerous Goods: Yes/Ja`, UN `(?!\d)`-lookahead, ADR-klasse
   in de instructie-tekst.

**NB AHQ-koppeling:** nodeapi schrijft `opdrachten_log`; AHQ's edge-function
`sync-al-opdrachten` leest die tabel → `ritten`. Daarom: extractie-KWALITEIT
verbeteren mag, maar VORM (veldnamen, datum `DD-MM-YYYY`, containertype-labels)
moet identiek blijven — anders breekt AHQ's sync. Hier niets aan vorm gewijzigd.

Geverifieerd: `node --check` (beide), losse multi-block-test (2 blokken/2 afzet)
+ lithium-test (incl. geen false-positive op "million"). Geen DFDS-PDF-fixture
in repo → geen end-to-end run.

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
