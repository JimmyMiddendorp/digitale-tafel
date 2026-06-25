# De Digitale Tafel — landingspagina

Eén statische pagina. **Geen build, geen server, geen database, geen externe libraries.**
Alles (HTML, CSS, JavaScript) zit in `index.html`.

## Bekijken / lokaal openen
Dubbelklik `index.html`, of serveer de map:
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

## Live hosting (GitHub Pages)
Staat aan via repo-instelling **Settings → Pages** (branch `main`, map `/`).
Elke push naar `main` ververst de live site automatisch (~1 min).

## Aanpassen
Bewerk `index.html`:
- **Kleuren** — CSS-variabelen bovenin het `<style>`-blok (`:root { --accent: … }`).
- **Teksten** — direct in de HTML-secties (elke sectie heeft een `<!-- comment -->` label).
- **Interview-stappen / testimonials** — de arrays `steps` en `quotes` onderin het `<script>`-blok.
- **Formulier** — front-end only; toont nu een bevestiging. Koppel `aanvraagForm` aan een
  mailservice/CRM-endpoint om aanvragen echt te versturen.

## Overdragen naar een andere beheerder
GitHub → **Settings → General → Transfer ownership**, of voeg iemand toe via
**Settings → Collaborators**. De nieuwe eigenaar hostt vanuit zijn eigen GitHub. Gratis.
