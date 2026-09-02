# geluidstesten

Registratieformulier geluidsoverlast met beheerdersdashboard.
Cloudflare Worker + D1. Zwart-wit, mobielvriendelijk, NL/EN.

---

## Zelf live zetten

Vier commando's op je eigen computer (Node 18+ nodig):

```bash
git clone -b claude/geluidstesten-form-7jymja https://github.com/JimmyMiddendorp/digitale-tafel.git
cd digitale-tafel/geluidstesten
npm install
npx wrangler login          # opent je browser, klik op Allow
./golive.sh                 # tabellen aanmaken, uitrollen, controleren
```

`golive.sh` print de live URL. Werkt ook met een API-token in plaats van
`wrangler login`: `CLOUDFLARE_API_TOKEN=... ./golive.sh`.

Wrangler print de live URL, iets als `https://geluidstesten.<jouw-subdomein>.workers.dev`.
Die deel je met bewoners. Het dashboard zit op `/dashboard`.

Later iets aanpassen? Wijzig het bestand en draai `npm run deploy` opnieuw.
De database blijft staan.

### Eigen domein
Cloudflare-dashboard → Workers & Pages → `geluidstesten` → Settings → Domains & Routes
→ Add → Custom domain. Het domein moet in hetzelfde Cloudflare-account staan.

---

## Hoe het werkt

| Route | Wat |
|---|---|
| `/` | Startscherm: postcode + huisnummer, daarna het eigen overzicht |
| `/dashboard` | Beheerdersoverzicht, achter wachtwoord |
| `/api/*` | JSON-API (`open`, `save`, `admin`) |

**Herkenning op adres.** Een bewoner vult postcode en huisnummer in en komt op zijn
eigen pagina. Postcode en huisnummer worden genormaliseerd (hoofdletters, spaties
en streepjes eruit), dus `1234 ab` en `1234AB` openen hetzelfde dossier — ook op een
andere telefoon of na het wissen van de browsergeschiedenis. Een `UNIQUE`-index op
die sleutel maakt twee dossiers voor één adres onmogelijk.

**Invullen.** Het dossier toont een tabel met regels: datum, tijdstip start, tijdstip
stop, korte omschrijving en een vinkje "niet thuis". Datum en starttijd van een nieuwe
regel staan automatisch op nu en zijn aanpasbaar. Er staat altijd één lege regel klaar;
"+ Regel toevoegen" maakt er meer.

**Opslaan.** De knop staat bovenaan in beeld en toont de status: ✓ opgeslagen, of
"Niet opgeslagen". Daarnaast slaat de app zelf op zodra iemand stopt met typen, bij
het wegklikken van het tabblad, en via `sendBeacon` bij het sluiten van de pagina.
Mislukt een poging, dan probeert hij het opnieuw en waarschuwt de browser bij
weggaan. Eén opslagactie is één D1-batch (dus één transactie): de oude regels
verdwijnen nooit zonder dat de nieuwe er staan.

**Dashboard.** Alle meldingen op adres, met naam, veroorzaker, richting, aantal
ingevulde dagen, de periode en alle omschrijvingen. Zoekveld (ook op postcode) en
CSV-export.

---

## Wachtwoord

Staat in `wrangler.toml` onder `[vars] ADMIN_PASSWORD` (nu `333`). Sterker maken,
zonder verder iets te wijzigen:

```bash
npx wrangler secret put ADMIN_PASSWORD
```

Een secret gaat vóór de waarde in `wrangler.toml`.

---

## Lokaal draaien

```bash
npm install
npx wrangler d1 execute geluidstesten --local --file=./schema.sql
npm run dev                 # http://127.0.0.1:8787
```

## Database

D1 `geluidstesten` (`45abc631-79dd-4d70-b54f-1d2faa8f9035`, regio WEUR), tabellen
`address_reports` en `log_entries` — zie `schema.sql`. `npm run db:init` is veilig om
opnieuw te draaien: het maakt alleen aan wat nog niet bestaat.

> In deze database staan ook twee lege tabellen `reports` en `entries` uit een eerdere
> opzet. Ze worden nergens gebruikt. Opruimen mag, hoeft niet:
> `npx wrangler d1 execute geluidstesten --remote --command "DROP TABLE IF EXISTS entries; DROP TABLE IF EXISTS reports;"`

## Privacy

Wie een postcode en huisnummer intypt, ziet wat op dat adres is ingevuld — namen,
adressen en klachten over buren. Handig, maar het betekent ook dat een buurman die
het adres raadt kan meekijken. Wil je dat dichtzetten, dan is een persoonlijke
pincode per adres de kleinste ingreep.
