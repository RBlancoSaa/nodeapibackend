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
