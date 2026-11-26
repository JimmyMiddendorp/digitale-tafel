#!/usr/bin/env bash
# Zet Neighbor Noise live. Vereist eerst `npx wrangler login`
# (of CLOUDFLARE_API_TOKEN in de omgeving).
set -euo pipefail
cd "$(dirname "$0")"

TOML=wrangler.toml
LOG=$(mktemp)

echo "== 1/4 database =="
if grep -q 'PLACEHOLDER_WORDT_INGEVULD_DOOR_GOLIVE' "$TOML"; then
  # Bestaat de database al, dan gebruiken we die; anders maken we hem aan.
  ID=$(npx wrangler d1 list --json 2>/dev/null \
       | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
           try{const m=JSON.parse(s).find(d=>d.name==="neighbornoise-logboek");console.log(m?m.uuid:"")}catch(e){console.log("")}})')
  if [ -z "$ID" ]; then
    npx wrangler d1 create neighbornoise-logboek --location weur 2>&1 | tee "$LOG"
    ID=$(grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' "$LOG" | head -1)
  fi
  [ -n "$ID" ] || { echo "Kon geen database-id vinden. Maak hem met: npx wrangler d1 create neighbornoise-logboek"; exit 1; }
  sed -i.bak "s/PLACEHOLDER_WORDT_INGEVULD_DOOR_GOLIVE/$ID/" "$TOML" && rm -f "$TOML.bak"
  echo "   database-id ingevuld: $ID"
else
  echo "   database-id staat al in wrangler.toml"
fi

echo "== 2/4 tabellen (veilig om opnieuw te draaien) =="
npx wrangler d1 execute neighbornoise-logboek --remote --file=./schema.sql --yes

echo "== 3/4 uitrollen =="
if ! npx wrangler deploy 2>&1 | tee "$LOG"; then
  if grep -qiE 'route|zone|domain' "$LOG"; then
    echo
    echo "   Het eigen domein kon nog niet gekoppeld worden (zone nog niet actief in"
    echo "   Cloudflare?). Ik rol nu uit zonder domein; je site komt op workers.dev."
    echo "   Zet neighbornoise.com later aan via: Workers & Pages > neighbornoise-logboek >"
    echo "   Settings > Domains & Routes > Add > Custom domain."
    cp "$TOML" "$TOML.met-domein"
    node -e 'const f="wrangler.toml",fs=require("fs");fs.writeFileSync(f,fs.readFileSync(f,"utf8").split("[[routes]]")[0].trimEnd()+"\n")'
    npx wrangler deploy 2>&1 | tee "$LOG"
  else
    echo "Uitrollen mislukt. Zie de melding hierboven."; exit 1
  fi
fi

URL=$(grep -oE 'https://[a-z0-9.-]+\.(workers\.dev|com)' "$LOG" | head -1)
echo "== 4/4 controle op ${URL} =="
curl -fsS -o /dev/null -w "   /            %{http_code}\n" "$URL/"
curl -fsS -o /dev/null -w "   /dashboard   %{http_code}\n" "$URL/dashboard"
curl -fsS -X POST "$URL/api/open" -H 'content-type: application/json' \
  -d '{"postcode":"1000AA","huisnummer":"1"}' -o /dev/null -w "   /api/open    %{http_code}\n"

echo
echo "LIVE:      $URL"
echo "Dashboard: $URL/dashboard"
