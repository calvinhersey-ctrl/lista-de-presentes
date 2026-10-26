# Lista de presentes · Bruna & Calvin

Live at https://calvinhersey-ctrl.github.io/lista-de-presentes/ (add #pt or #en to force a language).

A one-page gift list (Portuguese and English). Family pick a gift, leave their name, and the
item moves to "Already given" for everyone, so nothing gets bought twice.

- `index.html`, `css/`, `js/` – the site (static, hosted on GitHub Pages).
- `js/content.js` – every word on the page and the gift list. Edit here.
- `js/config.js` – the shared-list connection (Supabase URL + anon key). Empty = test mode.
- `supabase/migrations/` – the database tables and the claim/unclaim functions.
- `images/` – product photos.

## Publish a change

```bash
./scripts/publish.sh
```

## Set up the shared list (once, already done)

```bash
supabase projects create lista-de-presentes --org-id usxdyjptlolptuswfcbe --region us-west-1 --db-password "$(cat .secrets/db-password)"
supabase link --project-ref <ref from the command above> --password "$(cat .secrets/db-password)"
supabase db push
supabase projects api-keys --project-ref <ref>
```

Then paste the project URL and the `anon` key into `js/config.js`.
