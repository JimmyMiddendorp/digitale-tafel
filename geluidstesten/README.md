# geluidstesten

Registratieformulier geluidsoverlast + admin-dashboard. Cloudflare Worker + D1.
Zwart-wit, mobielvriendelijk, NL/EN.

## Routes
| Route | Wat |
|---|---|
| `/` | Formulier + eigen overzicht voor de melder |
| `/dashboard` | Beheerdersoverzicht, achter wachtwoord |
| `/api/*` | JSON-API (report, entry, admin) |

## Hoe het werkt
- De melder vult adresgegevens in en voegt per keer een registratie toe
  (datum, tijdstip start/stop, korte omschrijving, of "ik was niet thuis").
- Datum en starttijd staan bij het openen automatisch op **nu** en zijn aanpasbaar.
- Het dossier krijgt een id dat in `localStorage` bewaard wordt; bij terugkomen
  ziet de melder zijn eigen overzicht weer, ook na dagen.
- Beheerders zien op `/dashboard` alle meldingen: wie, welk adres, om wie het gaat,
  hoeveel dagen er zijn ingevuld, de periode en alle omschrijvingen. Met zoekveld
  en CSV-export.

## Wachtwoord
Staat in `wrangler.toml` onder `[vars] ADMIN_PASSWORD`. Aanpassen kan ook zonder
deploy als secret:
```bash
npx wrangler secret put ADMIN_PASSWORD
```

## Deployen
```bash
npm install
npx wrangler login                 # of: export CLOUDFLARE_API_TOKEN=...
npm run db:init                    # tabellen aanmaken (eenmalig, remote)
npm run deploy
```

## Lokaal draaien
```bash
npm install
npx wrangler d1 execute geluidstesten --local --file=./schema.sql
npm run dev                        # http://127.0.0.1:8787
```

## Database
D1 `geluidstesten` (`45abc631-79dd-4d70-b54f-1d2faa8f9035`, regio WEUR).
Schema staat in `schema.sql`: tabellen `reports` en `entries`.
