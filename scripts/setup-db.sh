#!/usr/bin/env bash
# One-time setup of the shared gift list (free Supabase project).
# Creates the project, loads the tables, and writes the keys into js/config.js.
set -euo pipefail
cd "$(dirname "$0")/.."

ORG_ID="usxdyjptlolptuswfcbe"   # Supabase org "Casa Calvin e Bruna"
NAME="lista-de-presentes"
PW_FILE=".secrets/db-password"

if [ ! -s "$PW_FILE" ]; then
  mkdir -p .secrets
  LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 28 > "$PW_FILE"
  chmod 600 "$PW_FILE"
fi
PW="$(cat "$PW_FILE")"

echo "→ Looking for an existing project called $NAME…"
REF="$(supabase projects list -o json 2>/dev/null | python3 -c 'import json,sys; ps=[p for p in json.load(sys.stdin) if p["name"]=="'"$NAME"'"]; print(ps[0]["ref"] if ps else "")')"

if [ -z "$REF" ]; then
  echo "→ Creating the free project (takes a minute or two)…"
  supabase projects create "$NAME" --org-id "$ORG_ID" --region us-west-1 --db-password "$PW" -o json > .secrets/project.json
  REF="$(python3 -c 'import json; print(json.load(open(".secrets/project.json"))["ref"])')"
fi
echo "   project ref: $REF"

echo "→ Waiting for the database to come up…"
for i in $(seq 1 40); do
  STATUS="$(supabase projects list -o json 2>/dev/null | python3 -c 'import json,sys; ps=[p for p in json.load(sys.stdin) if p["ref"]=="'"$REF"'"]; print(ps[0]["status"] if ps else "")')"
  [ "$STATUS" = "ACTIVE_HEALTHY" ] && break
  sleep 10
done

echo "→ Linking and loading the tables…"
supabase link --project-ref "$REF" --password "$PW" >/dev/null
supabase db push --password "$PW"

echo "→ Fetching the public key…"
ANON="$(supabase projects api-keys --project-ref "$REF" -o json | python3 -c 'import json,sys; ks=json.load(sys.stdin); print(next(k["api_key"] for k in ks if k["name"]=="anon"))')"
URL="https://$REF.supabase.co"

cat > js/config.js <<EOF
// Connection to the shared list (Supabase). Leave both empty to run the page
// in test mode, where choices are saved only in the visitor's own browser.
window.CONFIG = {
  SUPABASE_URL: "$URL",
  SUPABASE_ANON_KEY: "$ANON",
};
EOF

echo
echo "✓ Done. The shared list is live at $URL and js/config.js is filled in."
echo "  Test it: python3 -m http.server 8765 --bind 127.0.0.1  →  http://127.0.0.1:8765/"
