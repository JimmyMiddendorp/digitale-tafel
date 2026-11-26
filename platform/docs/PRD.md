# NeighborNoise Platform – PRD fase 1

Versie 1.0 · 25 november 2026 · Status: gebouwd (zie `README.md` en `DEPLOY.md`)

## 1. Doel

Fase 1 maakt het eigen werk van NeighborNoise digitaal: van nieuwe plaatsing tot verzonden rapport, zonder WhatsApp-berichten, losse mails of handmatige specificaties.

Succes betekent:

- Elke meting staat op één plek, met per stap wie het deed en wanneer.
- Niets blijft liggen zonder dat iemand het ziet: termijnen worden automatisch bewaakt.
- Plaatsers sturen geen berichten of specificaties meer; afvinken in de app is genoeg.
- Eigenaren zien in één scherm waar elke meter staat en wat aandacht nodig heeft.

Buiten fase 1: corporatie-portaal, aanvragen door corporaties, facturen aan corporaties, bewoner-app met geluidsopname (fase 2 en de NeighborNoise App).

## 2. Rollen

| Rol | Wie | Apparaat | Rechten |
| --- | --- | --- | --- |
| Eigenaar | Eric, Jacco | Laptop | Alles lezen en wijzigen, gebruikers en instellingen beheren |
| Controle | Peter | Laptop | Alle metingen lezen; plaatsingen controleren, stappen afvinken, rapport uploaden en verzenden, notities |
| Plaatser | Sem, Jimmy, John | Telefoon | Alleen eigen opdrachten; plaatsen, ophalen, foto's, checklist |
| Facturatie | Natasja | Laptop | Uitbetaling plaatsers per maand, tarieven per zone; metingen alleen lezen |

Iedere gebruiker logt in met e-mail en wachtwoord. Nieuwe gebruikers worden door een eigenaar uitgenodigd en kiezen zelf hun wachtwoord via de link in de uitnodigingsmail. Wachtwoord vergeten werkt via een resetlink.

## 3. De meting: levenscyclus

| # | Stap | Wie | Wat gebeurt er |
| --- | --- | --- | --- |
| 0 | Aangemaakt | Eigenaar | Plaatsing aangemaakt en toegewezen; plaatser krijgt mail en melding |
| 1 | Geplaatst | Plaatser | Meter gekozen, checklist afgevinkt, tijdstip vastgelegd; ophaaldatum = plaatsdatum + meetduur |
| 1b | Plaatsing gecontroleerd | Controle | Binnen de controletermijn (standaard 24 uur), anders rood |
| 2 | Opgehaald | Plaatser | Checklist, dagboek ja/nee + foto, geluid gehoord ja/nee, opmerking |
| 3 | Dagboek verwerkt | Controle | |
| 4 | Data gecontroleerd | Controle | In de externe meetsoftware |
| 5 | Rapportage klaar | Controle | PDF geüpload, uitkomst gekozen |
| 6 | Verzonden | Controle | Rapport per mail naar de corporatie (bijlage); rapportdeadline = ophalen + 14 dagen |
| 7 | Afgerond | Eigenaar | Dossier gesloten |

Elke stap schrijft een regel in het activiteitenlog met tijd en uitvoerder. Het detailscherm toont de checklist uit dat log.

## 4. Functionele eisen

### 4.1 Eigenaarsdashboard

- **Kerncijfers:** meters in het veld (van totaal), rapportages te laat, wacht op controle (waarvan > termijn), verzonden deze maand.
- **Regio's:** per regio aantal metingen en verdeling opgeleverd / in verwerking / in het veld / te laat; klikken filtert.
- **Meteroverzicht:** per meternummer: adres, corporatie, ophaaldatum, plaatser; rood als ophalen te laat is; beschikbaar met laatste adres.
- **Metingentabel:** code, meter, adres, bewoner en telefoon, corporatie, plaatser, plaats- en ophaaldatum met tijd, meetduur, dagboek, checklist (8 blokjes), status, rapportdeadline. Zoeken; filters op regio, corporatie, te laat, wacht op controle, status.
- **Detailscherm:** alle gegevens, opdrachtnummer, checklist met tijd en uitvoerder, foto's, notities, activiteitenlog, uitkomst; knoppen: bewerken, herinnering sturen (mail naar plaatser of controle), dossier afronden, verwijderen.
- **Nieuwe plaatsing:** corporatie, opdrachtnummer, adres, postcode, plaats, bewoner, telefoon, meetduur (1 of 2 weken), plaatser, plaatsdatum, opmerking. Plaatser krijgt direct mail en melding.
- **Beheer:** gebruikers (uitnodigen, rol, werkgebied, IBAN, deactiveren), corporaties (naam, regio, contactmail voor rapporten), meters (nummer, actief), regio's en plaatsen (plaats → regio, voor zones), instellingen (controletermijn, rapporttermijn, tarieven per zone).

### 4.2 Controle (Peter)

- **Net geplaatst, controleren:** lijst met knop "Gecontroleerd"; rood na de termijn.
- **Rapportage-wachtrij:** opgehaalde meters met dagboekfoto's, opmerkingen plaatser, geluid gehoord, deadline; knoppen per volgende stap: dagboek verwerkt → data gecontroleerd → rapport uploaden (PDF + uitkomst) → verzenden naar corporatie.
- **Notities** per meting; **activiteitenoverzicht** van alles wat gebeurt.

### 4.3 Plaatser-app (PWA)

- Installeerbaar op het beginscherm (manifest, service worker).
- **Mijn ronde:** te plaatsen (komende 14 dagen) en op te halen (komende 7 dagen), te laat bovenaan, label "Nieuw", voortgangsbalk vandaag.
- **Herinneringen** bovenaan: vandaag plaatsen, over 2 dagen ophalen.
- **Per adres:** corporatie, meetduur, bewoner met telefoon (bellen), adres met kaartlink, opmerking.
- **Plaatsen:** meter kiezen uit vrije meters, datum en tijd (standaard nu), verplichte checklist (meter aan, juiste kamer, uitleg gegeven, QR-sticker geplakt, ophaaldatum doorgegeven), opmerking.
- **Ophalen:** verplichte checklist (meter mee, dagboek gefotografeerd of afwezig, bewoner geïnformeerd), dagboek ja/nee, foto's (camera), geluid gehoord ja/nee, opmerking.
- **Mijn maand:** aantal geplaatst/opgehaald en verdiend bedrag.

### 4.4 Facturatie (Natasja)

- Per maand per plaatser: alle plaatsingen en ophalingen met datum, meter, adres, opdrachtnummer, zone en bedrag; totaal en IBAN.
- Zone: plaats = werkgebied plaatser → zone 1; zelfde regio → zone 2; anders zone 3. Tarieven instelbaar (standaard €42,50 / €55 / €65).
- Status per maand: concept → goedgekeurd → betaald; specificatie mailen naar plaatser; CSV-export.

### 4.5 Meldingen en e-mails

Iedere gebruiker heeft een meldingenbel met teller en lijst; nieuwe meldingen verschijnen als pop-up.

| Trigger | Ontvanger | Kanaal |
| --- | --- | --- |
| Nieuwe plaatsing toegewezen | Plaatser | Mail + melding |
| Dag vóór plaatsdatum | Plaatser | Mail + melding |
| Plaatsdatum voorbij, niet afgevinkt | Eigenaar | Melding (rood) |
| Meter geplaatst | Controle, eigenaar | Melding |
| Plaatsing langer dan termijn niet gecontroleerd | Eigenaar, controle | Melding (rood) |
| Ophalen over 2 dagen | Plaatser | Mail + melding |
| Ophaaldatum voorbij, niet afgevinkt | Eigenaar | Melding (rood) |
| Meter opgehaald | Controle | Melding |
| Geen dagboek aangeleverd | Eigenaar | Melding |
| Rapportdeadline verstreken | Eigenaar, controle | Melding (rood) |
| Rapport verzonden | Corporatie | Mail met PDF |
| Uitnodiging / wachtwoord reset | Gebruiker | Mail |
| Specificatie maand | Plaatser | Mail |

Tijdgestuurde meldingen draaien elk kwartier (Cloudflare Cron Trigger) en worden per gebruiker en gebeurtenis maar één keer verstuurd.

## 5. Niet-functionele eisen

- **Hosting:** Cloudflare Workers (EU-gebruikers), D1-database, R2-opslag voor foto's en rapporten, Cron Triggers.
- **E-mail:** Resend vanaf het eigen domein; zonder API-sleutel komen mails alleen in het logboek.
- **Beveiliging:** wachtwoorden met PBKDF2 (100.000 iteraties, SHA-256), sessiecookie HttpOnly + Secure + SameSite=Lax, 30 dagen; rechten per rol op elke API-route; plaatsers zien alleen eigen opdrachten; bestanden alleen via ingelogde API.
- **AVG:** persoonsgegevens alleen voor ingelogde medewerkers; verwijderen van een meting verwijdert foto's en rapport.
- **Tijdzone:** alles in Europe/Amsterdam.
- **Taal:** Nederlands; teksten gecentraliseerd zodat Engels later kan.
- **Toegankelijkheid:** zichtbare focus, labels op alle velden, werkt vanaf 360 px breed.

## 6. Datamodel (D1)

`users`, `sessions`, `tokens`, `regions`, `places`, `corporations`, `meters`, `measurements`, `photos`, `events`, `notes`, `notifications`, `emails`, `settings`, `payouts`. Zie `migrations/0001_init.sql`.

## 7. Acceptatiecriteria (getest)

1. Eerste eigenaar maakt zijn account aan via /setup; daarna is /setup dicht.
2. Eigenaar nodigt plaatser uit; uitnodigingsmail met link; plaatser kiest wachtwoord en logt in.
3. Eigenaar maakt plaatsing; plaatser krijgt mail en ziet de opdracht met "Nieuw".
4. Plaatser plaatst zonder complete checklist → geweigerd; met checklist → status geplaatst, meter bezet, ophaaldatum berekend, controle krijgt melding.
5. Controle vinkt plaatsing gecontroleerd; zonder controle na termijn → rode melding bij eigenaar.
6. Plaatser haalt op met foto; foto zichtbaar bij controle; meter weer vrij.
7. Controle doorloopt stappen, uploadt PDF, verzendt; corporatie ontvangt mail met bijlage.
8. Plaatser ziet geen opdrachten van anderen (API geeft 403/404).
9. Facturatie ziet per maand per plaatser de juiste zone en bedragen.
