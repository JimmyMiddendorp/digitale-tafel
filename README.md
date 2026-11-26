# NeighborNoise

Drie losse Cloudflare Workers in één repo. Elk project heeft zijn eigen map,
eigen database en eigen `golive.sh`.

| Map | Worker | Wat het is | Waar het hoort te staan |
| --- | --- | --- | --- |
| `platform/` | `neighbornoise` | **Fase 1 — het interne platform.** Eigenaarsdashboard, controle, plaatser-app (PWA) en uitbetaling. D1 + R2 + cron + e-mail via Resend. | `app.neighbornoise.com` |
| `logboek/` | `neighbornoise-logboek` | Gratis publiek logboek voor bewoners: postcode + huisnummer, regels bijhouden, export. | `neighbornoise.com` |
| `geluidstesten/` | `geluidstesten` | Eerste versie van het logboek, Nederlandstalig. Opgevolgd door `logboek/`. | — |

> `platform/` en `logboek/` heetten allebei `neighbornoise` — in Worker-naam én
> databasenaam. De tweede deploy zou de eerste hebben overschreven. Het logboek
> heet daarom nu `neighbornoise-logboek`.

## Live zetten

Per project hetzelfde patroon:

```bash
cd platform          # of: logboek
npm install
npx wrangler login   # eenmalig
./golive.sh
```

`golive.sh` maakt wat ontbreekt (database, opslag), zet de tabellen klaar, rolt
uit en controleert daarna de live URL. Het script print het adres.

Voor `platform/` staat de volledige inrichting — Resend, corporaties, meters,
gebruikers uitnodigen — in `platform/DEPLOY.md`.

## workers.dev of pages.dev

Deze projecten zijn Workers, geen Pages-projecten, en komen dus op
`<naam>.<jouw-subdomein>.workers.dev`. Dat is hetzelfde netwerk, dezelfde
snelheid en net zo gratis als `pages.dev`.

Voor `platform/` is dat geen voorkeur maar een vereiste: de termijnbewaking
draait op een **Cron Trigger** (elk kwartier, `src/alerts.js`), en Pages
ondersteunt cron niet. Op `pages.dev` zouden de automatische meldingen —
"ophalen niet afgevinkt", "nog niet gecontroleerd", "rapportdeadline
verstreken" — stilvallen. Precies de bewaking waar fase 1 voor gebouwd is.

Wil je tóch een `pages.dev`-adres, dan kan dat alleen door de bewaking elders
onder te brengen (een losse mini-Worker met cron die `/api/admin/run-alerts`
aanroept). Dat is een extra bewegend deel voor een adres dat verder niets
toevoegt.
