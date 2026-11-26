# Live zetten op Cloudflare

Reken op ongeveer 30 minuten. Alles valt binnen de gratis lagen van Cloudflare (Workers, D1, R2) en Resend (3.000 mails per maand).

## Wat je nodig hebt

- Node.js 20 of nieuwer op je laptop
- Je Cloudflare-account
- Een Resend-account (resend.com)
- Het domein waarvan de mails komen, bijvoorbeeld neighbornoise.com, het liefst ook in Cloudflare

## 1. Project klaarzetten

```bash
cd neighbornoise
npm install
npx wrangler login
```

## 2. Database en opslag aanmaken

```bash
npx wrangler d1 create neighbornoise
```

Kopieer het `database_id` uit de uitvoer naar `wrangler.toml` (regel `database_id = ...`).

```bash
npx wrangler r2 bucket create neighbornoise-files
npm run db:remote
```

R2 moet één keer aangezet worden in het Cloudflare-dashboard (R2 › Purchase/Enable, gratis tot 10 GB).

## 3. Adres van de app

Zet in `wrangler.toml` bij `[vars]` het adres waar de app komt te staan. Dit adres staat in de links in de e-mails.

```toml
APP_URL = "https://app.neighbornoise.com"
MAIL_FROM = "NeighborNoise <noreply@neighbornoise.com>"
```

Gebruik je eerst het gratis Cloudflare-adres, dan is dat `https://neighbornoise.<jouw-subdomein>.workers.dev`.

## 4. E-mail via Resend

1. Resend › Domains › Add domain › `neighbornoise.com`.
2. Zet de DNS-records die Resend toont in Cloudflare DNS (SPF, DKIM). Wacht tot Resend "Verified" toont.
3. Resend › API Keys › Create (rechten: Sending access).
4. Sla de sleutel op als geheim:

```bash
npx wrangler secret put RESEND_API_KEY
```

Zonder sleutel draait de app in testmodus: mails worden niet verstuurd maar staan in Beheer › E-mails.

## 5. Live zetten

```bash
npm run deploy
```

Eigen domein: Cloudflare › Workers & Pages › neighbornoise › Settings › Domains & Routes › Add › Custom domain › `app.neighbornoise.com`.

## 6. Eerste keer inloggen

1. Open de app direct na het deployen. Je komt op "Eerste account": maak het eigenaarsaccount aan. Daarna is dat scherm dicht.
2. Beheer › Corporaties: voeg de corporaties toe met het e-mailadres waar rapporten naartoe moeten.
3. Beheer › Meters: voeg de meternummers toe (bijvoorbeeld 1 t/m 24).
4. Beheer › Regio's en plaatsen: controleer de plaatsen; die bepalen de zones voor de uitbetaling.
5. Beheer › Gebruikers: nodig Jacco, Peter, Natasja, Sem, Jimmy en John uit. Plaatsers krijgen een werkgebied en IBAN.
6. Plaatsers openen de link uit de mail op hun telefoon en kiezen "Zet op beginscherm" (iPhone: Deel › Zet op beginscherm).

## Bijwerken

Nieuwe versie: `npm run deploy`. Nieuwe databasemigratie: `npm run db:remote` en daarna deployen.

## Back-up

D1 maakt automatisch herstelpunten (Time Travel, 30 dagen). Handmatige export:

```bash
npx wrangler d1 export neighbornoise --remote --output backup.sql
```
