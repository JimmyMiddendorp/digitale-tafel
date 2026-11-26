# Neighbor Noise

Gratis logboek voor geluidsoverlast van buren, met beheerdersdashboard.
Cloudflare Worker + D1. Zwart-wit, mobiel-first, Engels met NL-schakelaar.

Zusterproject van `../geluidstesten` — zelfde techniek, andere positionering
en een eigen database.

---

## Live zetten

```bash
npm install
npx wrangler login     # opent je browser, klik Allow
./golive.sh
```

`golive.sh` maakt de database aan (als die er nog niet is), zet de tabellen
klaar, rolt uit en controleert daarna `/`, `/dashboard` en `/api/open` op de
live URL. Lukt het koppelen van neighbornoise.com nog niet, dan rolt hij uit op
workers.dev en zegt erbij hoe je het domein later aanzet.

Werkt ook met een token: `CLOUDFLARE_API_TOKEN=... ./golive.sh`.

### Eigen domein
`wrangler.toml` koppelt `neighbornoise.com` en `www.neighbornoise.com` als
custom domain. Voorwaarde is dat de zone in hetzelfde Cloudflare-account actief
is (nameservers overgezet én door Cloudflare bevestigd).

---

## Positionering

De markt wordt bediend door meetdiensten met hardware: een koffer met een
klasse 1-geluidmeter die een consulent bij de melder plaatst, twee weken meten,
analyse door een akoestisch adviseur, rapport via een portal. Prijs op aanvraag,
en een particulier kan het niet zelf bestellen — dat loopt via verhuurder,
gemeente of VvE.

Neighbor Noise zit bewust aan de andere kant:

| | Meetdienst | Neighbor Noise |
|---|---|---|
| Beginnen | offerte, afspraak, plaatsing | adres intypen |
| Kosten | op aanvraag | gratis |
| In huis | meetkoffer op statief | niets |
| Toestemming nodig | via verhuurder/gemeente | nee |
| Wat je krijgt | meetrapport met decibellen | eigen logboek, export |

De pagina claimt daarom **geen** juridische bewijskracht en **geen** decibellen.
Dat staat er met zoveel woorden ("Dit is een logboek, geen geluidsmeting"). Dat
is geen bescheidenheid maar strategie: overclaimen is precies waar meetdiensten
"decibel-apps" op afrekenen, en het kost ons niets om het eerlijk te zeggen.

Wat we wél bieden en zij niet: direct beginnen, een vinkje "niet thuis"
(geluid terwijl de woning leegstond kan niet van de melder zijn), een
samenvatting die de structuurvraag beantwoordt, en een export die de bewoner
zelf doorstuurt.

---

## Routes

| Route | Wat |
|---|---|
| `/` | Voorpagina + het eigen logboek van de bewoner |
| `/dashboard` | Beheerdersoverzicht, achter wachtwoord |
| `/api/*` | JSON-API (`open`, `save`, `admin`) |

## Hoe het werkt

**Herkenning op adres.** Postcode + huisnummer, genormaliseerd (hoofdletters,
geen spaties of streepjes). `1234 ab` en `1234AB` openen hetzelfde logboek, op
elk apparaat. Een `UNIQUE`-index maakt twee logboeken per adres onmogelijk. De
postcodecontrole is bewust ruim (3–10 letters/cijfers), zodat een Belgisch of
Brits adres er ook door komt.

**Taal.** Standaard Engels, Nederlands zodra de browser op `nl` staat. De
bezoeker kan altijd zelf wisselen; die keuze blijft bewaard.

**Een regel telt pas mee** bij een omschrijving, een eindtijd of het vinkje
"niet thuis". Datum en starttijd staan al ingevuld zodra een lege regel
verschijnt — daarop afgaan zou elk bezoek een loze regel opleveren.

**Opslaan.** Knop en status bovenaan in beeld. Daarnaast automatisch na het
typen, bij tabbladwissel en via `sendBeacon` bij het sluiten. Een mislukte
poging wordt herhaald en de browser waarschuwt bij weggaan. Eén opslagactie is
één D1-batch, dus een transactie.

**Samenvatting.** Aantal regels, aantal dagen, aantal meldingen na 23:00 en de
periode — precies de vragen die een verhuurder of VvE stelt.

## Wachtwoord

`wrangler.toml`, `[vars] ADMIN_PASSWORD` (nu `333`). Sterker:
`npx wrangler secret put ADMIN_PASSWORD` — een secret gaat vóór de waarde in
`wrangler.toml`.

## Lokaal draaien

```bash
npm install
npx wrangler d1 execute neighbornoise-logboek --local --file=./schema.sql
npx wrangler dev
```

## Privacy

Wie postcode en huisnummer intypt, ziet het logboek van dat adres. Dat staat
met zoveel woorden op de voorpagina, inclusief de waarschuwing om er niets in
te zetten wat de buren niet mogen lezen. Wil je dat dichtzetten, dan is een
pincode per adres de kleinste ingreep.
