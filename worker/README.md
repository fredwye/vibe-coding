# Worker `claude-prime-api`

Partie serveur des exercices Cloudflare du cours : **R2 + Access**, **D1** et **Turnstile**.

| Brique | Ressource Cloudflare | Rôle |
|---|---|---|
| R2 (`env.OUTILS`) | bucket `claude-prime-outils`, juridiction UE | copie complète de chaque fiche : `fiches/<id>.json` |
| D1 (`env.DB`) | base `claude-prime-db`, juridiction UE | index des fiches (recherche, tri, pagination) et commentaires |
| Access | application Zero Trust sur `*.workers.dev` | seules les adresses autorisées peuvent écrire |
| Turnstile | widget `claude-prime-turnstile` | bloque les robots avant tout ajout de commentaire |

## Routes

- `GET /api/etat` : état de l'écriture (et création des 25 fiches initiales à la première connexion autorisée)
- `GET /api/fiches` : toutes les fiches lues dans R2
- `PUT /api/fiches/:id` : modification d'une fiche (Access obligatoire)
- `GET /api/recherche?q=&categorie=&tri=nom|categorie|recent&page=` : recherche D1
- `GET /api/categories`
- `GET /api/commentaires?fiche=` / `POST /api/commentaires` (Turnstile puis Access)
- `/edition/outils.html` : console d'édition

## Réglages

- `wrangler.jsonc` : bindings et valeurs **non secrètes** (`ACCESS_TEAM_DOMAIN`, `ACCESS_AUD`, `TURNSTILE_SITE_KEY`).
- Secret à créer dans le tableau de bord (Settings > Variables and Secrets) : `TURNSTILE_SECRET_KEY`.
- Schéma D1 : `schema.sql` (à exécuter avec `--remote`).

## Workers Builds

Root directory `worker`, build `npm ci && npm test`, deploy `npx wrangler deploy`, branche `main`, *Preview builds* désactivés.
