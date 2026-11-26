#!/usr/bin/env bash
# Zet het NeighborNoise-platform live op Cloudflare.
# Vooraf: npm install && npx wrangler login   (of CLOUDFLARE_API_TOKEN in de omgeving)
set -euo pipefail
cd "$(dirname "$0")"

TOML=wrangler.toml
LOG=$(mktemp)
patch() { sed -i.bak "$1" "$TOML" && rm -f "$TOML.bak"; }

echo "== 1/6 database =="
if grep -q 'database_id = "00000000-0000-0000-0000-000000000000"' "$TOML"; then
  ID=$(npx wrangler d1 list --json 2>/dev/null \
       | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
           try{const m=JSON.parse(s).find(d=>d.name==="neighbornoise");console.log(m?m.uuid:"")}catch(e){console.log("")}})')
  if [ -z "$ID" ]; then
    npx wrangler d1 create neighbornoise --location weur 2>&1 | tee "$LOG"
    ID=$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$LOG" | head -1)
  fi
  [ -n "$ID" ] || { echo "Geen database-id gevonden. Maak hem met: npx wrangler d1 create neighbornoise"; exit 1; }
  patch "s/00000000-0000-0000-0000-000000000000/$ID/"
  echo "   database-id ingevuld: $ID"
else
  echo "   database-id staat al in wrangler.toml"
fi

echo "== 2/6 opslag voor foto's en rapporten =="
if npx wrangler r2 bucket create neighbornoise-files 2>&1 | tee "$LOG"; then
  echo "   bucket aangemaakt"
elif grep -qi 'already exists\|bestaat al' "$LOG"; then
  echo "   bucket bestond al"
else
  echo
  echo "   R2 kon niet worden aangemaakt. Meestal staat R2 nog uit in je account."
  echo "   Zet het eenmalig aan: Cloudflare-dashboard > R2 > Enable (gratis tot 10 GB),"
  echo "   en draai dit script daarna opnieuw."
  exit 1
fi

echo "== 3/6 databasetabellen =="
npx wrangler d1 migrations apply neighbornoise --remote

echo "== 4/6 uitrollen =="
npx wrangler deploy 2>&1 | tee "$LOG"
URL=$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' "$LOG" | head -1)
[ -n "$URL" ] || { echo "Kon de live URL niet uit de uitvoer lezen."; exit 1; }

echo "== 5/6 adres in de e-mails zetten =="
CUR=$(grep -oE '^APP_URL = "[^"]*"' "$TOML" | sed 's/.*"\(.*\)"/\1/')
if [ "$CUR" != "$URL" ]; then
  patch "s|^APP_URL = \".*\"|APP_URL = \"$URL\"|"
  echo "   APP_URL -> $URL (opnieuw uitrollen zodat links in mails kloppen)"
  npx wrangler deploy >/dev/null 2>&1
else
  echo "   APP_URL stond al goed"
fi

echo "== 6/6 controle =="
curl -fsS -o /dev/null -w "   /             %{http_code}\n" "$URL/"
curl -fsS -w "   /api/setup    %{http_code}  " -o "$LOG" "$URL/api/setup"; echo "(needed: $(node -pe 'try{JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).needed}catch(e){"?"}' "$LOG"))"

echo
echo "LIVE: $URL"
echo
echo "Open die link en maak het eerste eigenaarsaccount aan."
echo "Daarna sluit dat scherm zich. Verdere stappen staan in DEPLOY.md vanaf punt 6."
