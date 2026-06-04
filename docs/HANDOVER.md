# EasyTrip Automator (AL) — Handover & Project Status

> **Last updated:** 2026-06-04 (Security: endpoints afgeschermd)
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

### Sessie 2026-06-04 — Security: open endpoints afgeschermd
**Branch:** `claude/sharp-gauss-NgpnN` (nog niet op `main`).

**Probleem:** meerdere endpoints stonden volledig open:
- `/api/upload-from-inbox` + `/api/check-inbox` — geen auth; iedereen kon de hele
  mailverwerking triggeren.
- `/api/test-gmail-auth` + `/api/test-send-email` — lekten token-preview, scopes,
  e-mailadres; test-send kon zelfs mail versturen.

**Fix:**
- **Nieuwe helper** `guardCronEndpoint(req, res)` in `utils/auth.js`: soft-enforce
  voor LIVE endpoints. Geldig `?token=<CRON_SECRET>` (of `X-Token`/`X-Service-Token`)
  → toegestaan. Geen/fout token → toegestaan **mét waarschuwing** zolang
  `ENFORCE_CRON_AUTH ≠ true`, anders **401**. Zo breekt deployen de draaiende
  flow niet voordat de externe trigger het token meestuurt.
- Toegepast op `api/upload-from-inbox.js` en `api/check-inbox.js`.
- `api/test-gmail-auth.js` + `api/test-send-email.js`: **hard** afgeschermd met
  bestaande `acceptCronToken` (fail-closed) — vereisen `?token=<CRON_SECRET>`.

**⚠️ ACTIE VEREIST om de live-endpoints écht te sluiten (Bucket B):**
1. Zet `CRON_SECRET` in Vercel (als die er nog niet is).
2. Laat de **externe trigger** van `/api/upload-from-inbox` `?token=<CRON_SECRET>`
   meesturen (of header `X-Token`). Idem `/api/check-inbox` indien gebruikt.
3. Controleer dat de flow draait, zet dan **`ENFORCE_CRON_AUTH=true`** in Vercel
   om de deur te sluiten. Tot die tijd loggen de endpoints alleen een waarschuwing.

**Nog NIET gedaan (Bucket C, vereist keuze):** AHQ `/api/harvester`
webhook-handtekening — provider (Resend/Postmark/SES) nog niet gekozen.

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

**Security / verkoopbaarheid (uit audit deze sessie):**
7. ⏳ **`ENFORCE_CRON_AUTH=true` zetten** in Vercel + trigger `?token=` laten
   meesturen → live endpoints écht sluiten (zie sessie hierboven).
8. ⏳ **AHQ `/api/harvester` webhook-handtekening** — provider kiezen
   (Resend/Postmark/SES) en HMAC verifiëren.
9. ⏳ **Hardcoded opdrachtgever-data in parsers** (Jordex/B2L/DFDS/Eimskip/Neelevat:
   BTW/KVK/adres) + hardcoded `RECIPIENT_EMAIL` blokkeren doorverkoop — naar
   `klanten.json`/DB verplaatsen.
10. ⏳ **Parsers gedupliceerd met AHQ-harvester** — één bron van waarheid kiezen;
    eindbeeld: `.easy`-generatie naar AHQ en nodeapibackend pensioneren.
