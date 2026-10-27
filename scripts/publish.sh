#!/usr/bin/env bash
# Puts the site online with GitHub Pages (first time creates the repo; later runs just push).
set -euo pipefail
cd "$(dirname "$0")/.."

REPO="calvinhersey-ctrl/lista-de-presentes"

echo "→ Checking GitHub login…"
gh auth status >/dev/null 2>&1 || { echo "Not logged in to GitHub. Run: gh auth login"; exit 1; }
gh auth setup-git >/dev/null 2>&1 || true   # let git push with the GitHub login, no password prompt

if ! git remote get-url origin >/dev/null 2>&1; then
  echo "→ Creating the GitHub repo and uploading the site…"
  gh repo create "$REPO" --public --source=. --remote=origin --push \
    --description "Lista de presentes · Bruna & Calvin"
  echo "→ Switching on GitHub Pages…"
  gh api -X POST "repos/$REPO/pages" -f build_type=legacy -f 'source[branch]=main' -f 'source[path]=/' >/dev/null
else
  # Stamp the page's script and style links with the time, so nobody's browser keeps an old copy of the list.
  STAMP="$(date +%Y%m%d%H%M)"
  sed -i '' -E "s/\?v=[A-Za-z0-9]+/?v=$STAMP/g" index.html
  if ! git diff --quiet -- index.html; then
    git add index.html
    git commit -q -m "publish: asset version $STAMP"
  fi
  echo "→ Uploading the latest version…"
  git push origin main
fi

echo "→ Waiting for the site to build…"
for i in $(seq 1 30); do
  STATUS="$(gh api "repos/$REPO/pages" --jq .status 2>/dev/null || echo "")"
  [ "$STATUS" = "built" ] && break
  sleep 10
done
URL="$(gh api "repos/$REPO/pages" --jq .html_url)"
echo
echo "✓ Online at $URL"
echo "  Portuguese link: ${URL}#pt    English link: ${URL}#en"
