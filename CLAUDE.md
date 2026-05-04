# EasyTrip Automator — projectdocumentatie voor Claude

## Wat doet dit systeem

Node.js backend op Vercel die ongelezen Gmail-emails ophaalt, PDF/XLSX transportopdrachten parseert van vaste klanten, `.easy` XML-bestanden genereert voor EasyTrip (Microsoft Access transport-software), en die bestanden per email verstuurt naar `easybestanden@tiarotransport.nl`.

Trigger: GET `/api/upload-from-inbox`

---

## Architectuur

```
Gmail API
  → api/upload-from-inbox.js        (classificeert emails, roept handlers aan)
      → handlers/handle{Klant}.js   (orkestreert parse + XML + email)
          → parsers/parse{Klant}.js  (PDF/XLSX → JSON)
          → services/generateXmlFromJson.js  (JSON → .easy XML)
          → utils/gmailTransport.js  (verstuurt email met bijlage)
      → utils/lookups/terminalLookup.js  (opzoeken terminals, containers, rederijen)
      → services/supabaseClient.js   (Supabase Storage voor referentielijsten)
```

---

## Klanten en parsers

| Klant       | Parser                      | Status       | Matchcriteria                                       |
|-------------|-----------------------------|--------------|-----------------------------------------------------|
| Jordex      | parsers/parseJordex.js      | ✅ Actief     | afzender `@jordex.com`, onderwerp `OE\d{5}`         |
| Neelevat    | parsers/parseNeelevat.js    | ✅ Actief     | afzender `@neele-vat.com`                           |
| Ritra       | parsers/parseRitra.js       | ✅ Actief     | bestandsnaam `ritra`                                |
| B2L         | parsers/parseB2L.js         | ✅ Actief     | afzender `@b2l.nl` / `@b2lcargocare.com`            |
| DFDS        | parsers/parseDFDS.js        | ✅ Actief     | afzender `@dfds.com`                                |
| Steinweg    | parsers/parseSteinweg.js    | ✅ Actief     | bestandsnaam `pickupnotice`/`steinweg`              |
| Steder      | parsers/parseSteder.js      | ✅ Actief     | afzender `@stedergroup.com`                         |
| Eimskip     | parsers/parseEimskip.js     | ✅ Actief     | afzender `@eimskip.com`/`@eimskip.is`, `preferBody` |
| KWE         | handlers/handleKWE.js       | ❌ Stub       | afzender `@kwe.com`                                 |
| Easyfresh   | handlers/handleEasyfresh.js | ❌ Stub       | afzender `@easyfresh.com`                           |

Handler-matching volgorde in `upload-from-inbox.js`: bestandsnaam → afzender → onderwerp.

### preferBody architectuur (Eimskip)

Eimskip emails bevatten meerdere PDF-bijlagen (Transportopdracht + andere docs). Om te voorkomen dat de handler 3× wordt aangeroepen (één per PDF), heeft de Eimskip config `preferBody: true`. Dit zorgt ervoor dat:
- De PDF-per-bestand loop wordt **overgeslagen**
- De handler wordt **één keer** aangeroepen met `bodyText` + `pdfAttachments: [alle PDFs]`
- De handler zoekt zelf de Transportopdracht-PDF op aan de hand van bestandsnaam

Eimskip opdrachten hebben altijd: Lossen van container bij klant, Opzetten bij terminal.

---

## Jordex PDF-formaten

De Jordex PDF heeft drie vaste secties: **Pick-up terminal** → **Pick-up** (klant/lading) → **Drop-off terminal**.

- **Format A** (reefer): cargo-tabel IN de Pick-up sectie, regels met `m³` en `kg` op één regel
- **Format B** (droog, meerdere containers): meerdere `Cargo:` blokken elk met eigen `Date:` en `Reference:`
- **Format C** (export/bulk): cargo-tabel BUITEN de Pick-up sectie, header `Type Number Seal number Colli Volume Weight Description`

**Extra stops (bijladen):** Als een Jordex opdracht meerdere laadlocaties heeft, staat dit als "Extra stop" sectie in de PDF. Dit resulteert in **één** order met meerdere Laden-locaties (NIET aparte orders per laadlocatie). Geïmplementeerd in parseJordex.js met `extraStopBlokken`.

Datum-extractie: zoekt eerst "Date: DD Mon YYYY HH:MM" (tekst), dan "Date: DD/MM/YYYY" (numeriek), dan in de volledige regels als pickupBlok leeg is.

---

## Rederij — KRITIEKE REGEL

**De rederij MOET altijd uit de officiële `rederijen.json` lijst komen. Zelf invullen of een ruwe waarde doorsturen is VERBODEN.**

Dit is essentieel voor de voormelding. Als de rederij niet herkend wordt:
- `rederij` en `inleverRederij` worden **leeggemaakt** (lege string)
- Er verschijnt een waarschuwing in de logs
- Het .easy bestand wordt wel aangemaakt (zodat de gebruiker het kan corrigeren)

Geïmplementeerd in:
- `generateXmlFromJson.js` (regels ~140–150): lookup via `getRederijNaam()`, leegmaken bij mislukking
- Elke individuele parser roept `getRederijNaam()` aan via `utils/lookups/terminalLookup.js`

---

## Terminal lookup (`utils/lookups/terminalLookup.js`)

**Kritieke regel: nooit data invullen die niet in de lijst staat of in de PDF staat.**

Lookup volgorde bij `getTerminalInfoMetFallback(key)`:
1. Exacte naam/referentie match
2. Fuzzy score match (drempel ≥ 65)
3. Als niets gevonden → `null` teruggeven

Bij `null`: de parser gebruikt de ruwe naam/adres uit de PDF voor de locatieregel, en voegt een melding toe aan `instructies`: `"Opzet-terminal niet in lijst: [naam]"`.

**Auto-create is uitgeschakeld** — er wordt nooit automatisch een terminal aangemaakt.

Score-systeem `berekenScore()`:
- 100: exacte naam match
- 80: naam bevat zoekterm of vice versa
- 75: acroniem match (bijv. "UWT" → "United Waalhaven Terminals")
- 65: altNamen match
- 40+12×hits: woordoverlap (woorden > 3 tekens)
- Adres-bonus: +40 exacte straatnaam, +20 gedeeltelijk

---

## XML-generatie (`services/generateXmlFromJson.js`)

- Ondersteunt **N locaties** (niet hardcoded op 3): `data.locaties.slice(1, -1)` voor tussenliggende stops, `data.locaties.at(-1)` voor Afzetten
- `data.locaties[0]` = altijd Opzetten (terminal)
- Gebruikt `data.containertypeCode` als dat al ingevuld is door de parser (voorkomt dubbele mapping)
- `Voorgemeld` veld in XML komt uit `data.locaties[0/last].voorgemeld` (NIET hardcoded)
- Rederij wordt via `getRederijNaam()` opgezocht; bij mislukking → leeg (zie rederij-regel hierboven)
- Gooit een error als containertype niet gemapped kan worden → geen .easy bestand

---

## Supabase Storage (`referentielijsten` bucket)

| Bestand            | Inhoud                                                                       |
|--------------------|------------------------------------------------------------------------------|
| `op_afzetten.json` | Terminallijst: naam, adres, postcode, plaats, land, portbase_code, bicsCode, voorgemeld, altNamen |
| `containers.json`  | Containertypes: code (ISO), label, altLabels                                 |
| `rederijen.json`   | Rederijen: naam, code, altLabels                                             |
| `klanten.json`     | Klantdata: Bedrijfsnaam, Adres, Postcode, KVK, BTW, Telefoon etc.            |

**Eimskip opdrachtgever:** hardcoded in parseEimskip.js als `EIMSKIP JAC. MEISNER CUSTOMS & WAREHOUSING B.V.` — voeg toe aan klanten.json zodra KVK/BTW/adres beschikbaar zijn.

---

## Environment variables (Vercel)

```
GMAIL_CLIENT_ID
GMAIL_CLIENT_SECRET
GMAIL_REFRESH_TOKEN
RECIPIENT_EMAIL          (standaard = easybestanden@tiarotransport.nl)
SUPABASE_URL
SUPABASE_SERVICE_KEY
SUPABASE_LIST_PUBLIC_URL (publieke URL van de referentielijsten bucket)
```

---

## Email flow

1. `fetchUnreadMails()` haalt alle ongelezen Gmail-berichten op
2. `classifyEmail()` bepaalt type: `transport`, `reservering`, `update`, `onbekend`
3. Updates worden overgeslagen
4. Reserveringen gaan naar `handleReservering`
5. Transport:
   - **Normaal**: per PDF-bijlage wordt `findHandler()` aangeroepen
   - **preferBody** (Eimskip): één aanroep met bodyText + alle PDFs als array
6. Handler parseert → genereert XML → stuurt email met `.easy` bestand + originele PDF-bijlagen
7. Alle mails worden als gelezen gemarkeerd
8. Logboek wordt opgeslagen in Supabase tabel `verwerkingslog`

---

## Bekende issues / TODO

- **KWE parser** niet geïmplementeerd — stub gooit fout
- **Easyfresh parser** niet geïmplementeerd — stub gooit fout
- **DFDS email-body parser** niet geïmplementeerd — DFDS stuurt soms plain-text emails zonder PDF (bijv. RADTEC/ADR/UN orders)
- **Neelevat opdrachtgever BTW/KVK** ontbreken in parseNeelevat.js
- **Eimskip klanten.json entry** ontbreekt nog — opdrachtgever KVK/BTW/adres hardcoded in parser
- **Updates** worden overgeslagen, niet verwerkt

---

## Regels die ALTIJD gelden

1. **Nooit data invullen die niet in de PDF staat of in de referentielijst bevestigd is**
2. Als een terminal niet gevonden wordt → naam/adres uit PDF gebruiken + melding in bijzonderheden
3. Geen auto-create van terminals
4. **Rederij MOET uit de lijst komen** — bij mislukking leegmaken, nooit raw doorsturen
5. Commits gaan rechtstreeks naar `main` (Vercel deployt automatisch)

---

## Git workflow

```bash
# Vanuit de projectmap:
git add [bestanden]
git commit -m "omschrijving"
git push
# → Vercel deploy start automatisch
```
