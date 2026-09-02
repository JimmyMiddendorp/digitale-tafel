#!/usr/bin/env bash
# Zet geluidstesten live. Vereist CLOUDFLARE_API_TOKEN in de omgeving,
# of een eerdere `npx wrangler login`.
set -euo pipefail
cd "$(dirname "$0")"

echo "== 1/3 tabellen aanmaken (veilig om opnieuw te draaien) =="
npx wrangler d1 execute geluidstesten --remote --file=./schema.sql --yes

echo "== 2/3 uitrollen =="
npx wrangler deploy 2>&1 | tee /tmp/deploy.log

URL=$(grep -oE 'https://[a-z0-9.-]+\.workers\.dev' /tmp/deploy.log | head -1)
echo "== 3/3 controle op ${URL} =="
curl -fsS -o /dev/null -w "  /            %{http_code}\n" "$URL/"
curl -fsS -o /dev/null -w "  /dashboard   %{http_code}\n" "$URL/dashboard"
curl -fsS -X POST "$URL/api/open" -H 'content-type: application/json' \
  -d '{"postcode":"1000AA","huisnummer":"1"}' -o /dev/null -w "  /api/open    %{http_code}\n"

echo
echo "LIVE: $URL"
echo "Dashboard: $URL/dashboard"
