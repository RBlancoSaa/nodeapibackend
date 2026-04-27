# EasyTrip Automator — nodeapibackend

Node.js/Vercel backend die automatisch transportopdrachten verwerkt. De applicatie leest inkomende e-mails met PDF-bijlagen, herkent de klant/opdrachtgever, parseert de PDF naar een gestructureerd JSON-object, genereert een `.easy` XML-bestand en stuurt dat door naar EasyTrip via e-mail.

---

## Hoe het werkt

```
Inkomende e-mail (PDF bijlage)
        ↓
   check-inbox.js          ← Vercel cron of handmatige trigger
        ↓
   attachmentService.js    ← Herkent klant op basis van afzender of bestandsnaam
        ↓
   handlers/handle<Klant>  ← Per klant een eigen handler
        ↓
   parsers/parse<Klant>    ← Leest PDF en bouwt JSON object
        ↓
   generateXmlFromJson.js  ← Eén vast XML-formaat voor alle klanten
        ↓
   E-mail met .easy bestand naar EasyTrip
```

---

## Ondersteunde klanten

| Klant         | Parser                  | Status         |
|---------------|-------------------------|----------------|
| Jordex        | `parsers/parseJordex.js`    | Actief         |
| Neelevat      | `parsers/parseNeelevat.js`  | Actief         |
| Ritra         | `parsers/parseRitra.js`     | Actief         |
| DFDS          | `parsers/parseDFDS.js`      | In ontwikkeling|
| B2L           | `parsers/parseB2L.js`       | In ontwikkeling|
| Steinweg      | `parsers/parseSteinweg.js`  | In ontwikkeling|
| KWE           | `parsers/parseKWE.js`       | Stub           |
| Easyfresh     | `parsers/parseEasyfresh.js` | Stub           |

---

## Projectstructuur

```
nodeapibackend/
├── api/
│   └── check-inbox.js          # Vercel API endpoint — leest inbox en verwerkt mails
├── handlers/
│   └── handle<Klant>.js        # Per klant: aanroepen parser + versturen XML
├── parsers/
│   └── parse<Klant>.js         # Per klant: PDF → JSON
├── services/
│   ├── generateXmlFromJson.js  # JSON → .easy XML (één template voor alle klanten)
│   └── attachmentService.js    # Detecteert klant op basis van mail/bestandsnaam
├── utils/
│   ├── lookups/
│   │   └── terminalLookup.js   # Opzoeken terminal, containertype, rederij via Supabase
│   ├── gmailTransport.js       # Gmail SMTP transporter
│   ├── fsPatch.js              # Patch voor fs in Vercel serverless omgeving
│   └── supabaseClient.js       # Supabase client initialisatie
└── README.md
```

---

## Omgevingsvariabelen (`.env`)

Maak een `.env` bestand aan in de root (zie ook Vercel dashboard → Settings → Environment Variables):

```env
# IMAP — inkomende e-mail lezen
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_SECURE=true
IMAP_USER=jouw@gmail.com
IMAP_PASS=jouw-app-wachtwoord

# Gmail — uitgaande e-mail versturen
GMAIL_USER=jouw@gmail.com
GMAIL_PASS=jouw-app-wachtwoord

# Ontvanger van de gegenereerde .easy bestanden
RECIPIENT_EMAIL=easytripinbox@jouwbedrijf.nl

# Supabase — opzoeklijsten (terminals, containers, rederijen)
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_LIST_PUBLIC_URL=https://xxxx.supabase.co/storage/v1/object/public/lists
```

---

## Supabase opzoeklijsten

De volgende JSON-bestanden staan in de Supabase Storage bucket `lists`:

| Bestand             | Inhoud                                                      |
|---------------------|-------------------------------------------------------------|
| `op_afzetten.json`  | Terminals met naam, adres, postcode, portbase_code, bicsCode, voorgemeld |
| `containers.json`   | Containertype-codes (bijv. `20FT` → code `1`)              |
| `rederijen.json`    | Rederijnamen en bijbehorende EasyTrip-codes                |

**Let op:** bicsCode-waarden in `op_afzetten.json` worden als getal opgeslagen (bijv. `8713755270896.0`). De code haalt automatisch de `.0` eraf vóór het in de XML wordt gezet.

---

## XML-formaat

Alle parsers leveren hetzelfde JSON-object aan `generateXmlFromJson.js`. Dat bestand bevat het ene vaste XML-formaat (de "mal") dat EasyTrip verwacht. Parsers hoeven alleen de velden correct in te vullen — de XML-structuur zelf wordt nooit aangepast per klant.

Verplichte velden in het JSON-object:

```js
{
  ritnummer, containernummer, containertype, datum,
  klantnaam, klantadres, klantpostcode, klantplaats,
  opdrachtgeverNaam, opdrachtgeverAdres, opdrachtgeverPostcode,
  opdrachtgeverPlaats, opdrachtgeverTelefoon, opdrachtgeverEmail,
  opdrachtgeverBTW, opdrachtgeverKVK,
  lading, brutogewicht, geladenGewicht, colli, cbm,
  rederij, bootnaam, referentie,
  adr,           // 'Waar' of 'Onwaar'
  ladenOfLossen, // 'Laden' of 'Lossen'
  locaties: [
    { actie: 'Opzetten', naam, adres, postcode, plaats, land, voorgemeld, portbase_code, bicsCode },
    { actie: 'Laden' of 'Lossen', naam, adres, postcode, plaats, land },
    { actie: 'Afzetten', naam, adres, postcode, plaats, land, voorgemeld, portbase_code, bicsCode }
  ]
}
```

---

## Lokaal draaien

```bash
# Installeer dependencies
npm install

# Start lokale server (nodemon)
npm run dev
```

De Vercel-functie `api/check-inbox.js` is aan te roepen via:
```
GET http://localhost:3000/api/check-inbox
```

---

## Deployment

De applicatie draait op **Vercel**. Elke push naar `main` triggert automatisch een nieuwe deployment.

```bash
# Alles pushen naar main
git add .
git commit -m "Omschrijving van de wijziging"
git push origin main
```

---

## Bekende beperkingen / TODO

- KWE en Easyfresh parsers zijn nog stubs (geen logica)
- DFDS, B2L en Steinweg zijn in ontwikkeling
- Jordex Formats: A (reefer), B (meerdere cargo-blokken) en C (export/bulk) worden ondersteund
- Opzetten-terminal niet gevonden → wordt als opmerking in het `Instructies`-veld gezet
