# NeighborNoise platform · fase 1

Eigenaarsdashboard, controle (Peter), plaatser-app (PWA), facturatie (uitbetaling plaatsers), meldingen en e-mails.

- **Productbeschrijving:** `docs/PRD.md`
- **Live zetten:** `DEPLOY.md`

## Techniek

| Onderdeel | Keuze |
| --- | --- |
| Server | Cloudflare Worker met Hono (`src/`) |
| Database | Cloudflare D1, schema in `migrations/` |
| Bestanden | Cloudflare R2 (dagboekfoto's, rapporten) |
| Tijdgestuurde meldingen | Cron Trigger elk kwartier (`src/alerts.js`) |
| E-mail | Resend; zonder sleutel alleen in het logboek |
| Frontend | Eén pagina zonder buildstap (`public/`), installeerbaar als app |

## Lokaal draaien

```bash
npm install
npm run db:local
npm run dev            # http://localhost:8787
```

Open de app en maak het eerste eigenaarsaccount aan. In testmodus staan uitnodigingslinks en alle mails in Beheer › E-mails.

Tijdgestuurde meldingen handmatig starten: Beheer › Instellingen › "Termijnen nu controleren", of `curl "localhost:8787/__scheduled?cron=*/15+*+*+*+*"`.

## Testen

Met een lege lokale database en `npm run dev` actief:

```bash
npm test
```

De test doorloopt de hele keten (52 controles): setup, uitnodigen, rollen en rechten, plaatsen met checklist, meters vrij/bezet, controle, termijnbewaking zonder dubbele meldingen, ophalen met foto, rapport uploaden en verzenden, afronden, uitbetaling per zone, CSV, deactiveren en wachtwoord vergeten.

Lege lokale database: verwijder de map `.wrangler/state` en draai `npm run db:local` opnieuw.

## Rollen

| Rol | Start in | Kan |
| --- | --- | --- |
| Eigenaar | Overzicht | Alles, inclusief beheer |
| Controle | Controle | Plaatsingen controleren, stappen, rapport uploaden en verzenden, notities |
| Plaatser | Mijn ronde (telefoon) | Eigen opdrachten plaatsen en ophalen, foto's |
| Facturatie | Uitbetaling | Uitbetaling plaatsers, tarieven per zone |
