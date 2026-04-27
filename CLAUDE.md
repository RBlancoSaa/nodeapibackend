# EasyTrip Automator — projectdocumentatie voor Claude

## Wat doet dit systeem

Node.js backend op Vercel die ongelezen Gmail-emails ophaalt, PDF/XLSX transportopdrachten parseert van vaste klanten, `.easy` XML-bestanden genereert voor EasyTrip (Microsoft Access transport-software), en die bestanden per email verstuurt naar `opdrachten@tiarotransport.nl`.

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

| Klant       | Parser                    | Status      | Matchcriteria                              |
|-------------|---------------------------|-------------|--------------------------------------------|
| Jordex      | parsers/parseJordex.js    | ✅ Actief    | afzender `@jordex.com`, onderwerp `OE\d{5}` |
| Neelevat    | parsers/parseNeelevat.js  | ✅ Actief    | afzender `@neele-vat.com`                  |
| Ritra       | parsers/parseRitra.js     | ✅ Actief    | bestandsnaam `ritra`                       |
| B2L         | parsers/parseB2L.js       | ✅ Actief    | afzender `@b2l.nl` / `@b2lcargocare.com`  |
| DFDS        | parsers/parseDFDS.js      | ✅ Actief    | afzender `@dfds.com`                       |
| Steinweg    | parsers/parseSteinweg.js  | ✅ Actief    | bestandsnaam `pickupnotice`/`steinweg`     |
| KWE         | handlers/handleKWE.js     | ❌ Stub      | afzender `@kwe.com`                        |
| Easyfresh   | handlers/handleEasyfresh.js | ❌ Stub    | afzender `@easyfresh.com`                  |

Handler-matching volgorde in `upload-from-inbox.js`: bestandsnaam → afzender → onderwerp.

---

## Jordex PDF-formaten

De Jordex PDF heeft drie vaste secties: **Pick-up terminal** → **Pick-up** (klant/lading) → **Drop-off terminal**.

- **Format A** (reefer): cargo-tabel IN de Pick-up sectie, regels met `m³` en `kg` op één regel
- **Format B** (droog, meerdere containers): meerdere `Cargo:` blokken elk met eigen `Date:` en `Reference:`
- **Format C** (export/bulk): cargo-tabel BUITEN de Pick-up sectie, header `Type Number Seal number Colli Volume Weight Description`

Datum-extractie: zoekt eerst "Date: DD Mon YYYY HH:MM" (tekst), dan "Date: DD/MM/YYYY" (numeriek), dan in de volledige regels als pickupBlok leeg is.

---

## Terminal lookup (`utils/lookups/terminalLookup.js`)

**Kritieke regel: nooit data invullen die niet in de lijst staat of in de PDF staat.**

Lookup volgorde bij `getTerminalInfoMetFallback(key)`:
1. Exacte naam/referentie match
2. Fuzzy score match (drempel ≥ 65)
3. Als niets gevonden → `null` teruggeven

Bij `null`: de parser gebruikt de ruwe naam/adres uit de PDF voor de locatieregel, en voegt een melding toe aan `instructies`: `"Opzet-terminal niet in lijst: [naam]"`.

**Auto-create is uitgeschakeld** — er wordt nooit automatisch een terminal aangemaakt. Nieuwe terminals moeten handmatig worden toegevoegd aan `op_afzetten.json` in Supabase Storage.

Score-systeem `berekenScore()`:
- 100: exacte naam match
- 80: naam bevat zoekterm of vice versa
- 75: acroniem match (bijv. "UWT" → "United Waalhaven Terminals")
- 65: altNamen match
- 40+12×hits: woordoverlap (woorden > 3 tekens)
- Adres-bonus: +40 exacte straatnaam, +20 gedeeltelijk

---

## Supabase Storage (`referentielijsten` bucket)

| Bestand           | Inhoud                                          |
|-------------------|-------------------------------------------------|
| `op_afzetten.json` | Terminallijst: naam, adres, postcode, plaats, land, portbase_code, bicsCode, voorgemeld, altNamen |
| `containers.json` | Containertypes: code (ISO), label, altLabels    |
| `rederijen.json`  | Rederijen: naam, code, altLabels                |
| `klanten.json`    | Klantdata: Bedrijfsnaam, Adres, Postcode, etc.  |

**Voorgemeld veld** in terminals: `"ja"` of `"nee"` — bepaalt of EasyTrip de pre-notificatie aanmaakt. Nieuwe/onbekende terminals krijgen geen waarde totdat ze handmatig worden ingevuld.

---

## XML-generatie (`services/generateXmlFromJson.js`)

- Gebruikt `data.containertypeCode` als dat al ingevuld is door de parser (voorkomt dubbele mapping)
- Als `containertypeCode` leeg is, probeert `getContainerCodeFromOmschrijving()` de omschrijving te mappen
- `Voorgemeld` veld in XML komt uit `data.locaties[0/2].voorgemeld` (NIET hardcoded)
- Gooit een error als containertype niet gemapped kan worden → geen .easy bestand

---

## Environment variables (Vercel)

```
GMAIL_CLIENT_ID
GMAIL_CLIENT_SECRET
GMAIL_REFRESH_TOKEN
RECIPIENT_EMAIL          (standaard = zelfde als from-adres)
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
5. Transport: per PDF-bijlage wordt `findHandler()` aangeroepen
6. Handler parseert → genereert XML → stuurt email met `.easy` bestand
7. Alle mails worden als gelezen gemarkeerd
8. Logboek wordt opgeslagen in Supabase tabel `verwerkingslog`

---

## Bekende issues / TODO

- **KWE parser** niet geïmplementeerd — gooit "Parser KWE is nog niet geïmplementeerd"
- **Easyfresh parser** niet geïmplementeerd
- **Neelevat opdrachtgever BTW/KVK** ontbreken in parseNeelevat.js (lege strings)
- **Updates** worden overgeslagen, niet verwerkt
- **parseB2L, parseDFDS, parseSteinweg** geven geen rawData mee aan terminal lookup (minder kritiek)
- **Terminal lijst** moet handmatig worden aangevuld voor terminals die nog niet in `op_afzetten.json` staan (UWT, APM, Medrepair etc.)

---

## Regels die ALTIJD gelden

1. **Nooit data invullen die niet in de PDF staat of in de referentielijst bevestigd is**
2. Als een terminal niet gevonden wordt → naam/adres uit PDF gebruiken + melding in bijzonderheden
3. Geen auto-create van terminals
4. Wijzigingen altijd committen op branch `claude/jolly-bassi-e62a9a`, dan mergen naar `main` voor Vercel deploy
5. Worktree pad: `C:\Users\rblan\OneDrive\Desktop\nodeapibackend\.claude\worktrees\jolly-bassi-e62a9a`

---

## Git workflow

```bash
# Werken in worktree
cd C:\Users\rblan\OneDrive\Desktop\nodeapibackend\.claude\worktrees\jolly-bassi-e62a9a

# Committen
git add [bestanden]
git commit -m "Omschrijving"

# Pushen naar main (voor Vercel)
cd C:\Users\rblan\OneDrive\Desktop\nodeapibackend
git merge claude/jolly-bassi-e62a9a
git push origin main
```
