-- Schéma de la base D1 claude-prime-db
-- À exécuter UNE fois : tableau de bord D1 > claude-prime-db > Console (coller puis Execute)
-- ou : npx wrangler d1 execute claude-prime-db --remote --file=schema.sql   (ne pas oublier --remote)

-- Index des fiches (la copie complète de chaque fiche reste dans R2 : fiches/<id>.json)
CREATE TABLE IF NOT EXISTS fiches (
  id          TEXT PRIMARY KEY,
  nom         TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  categorie   TEXT NOT NULL DEFAULT '',
  url         TEXT NOT NULL DEFAULT '',
  version     INTEGER NOT NULL DEFAULT 1,
  modifie_le  TEXT NOT NULL DEFAULT (datetime('now')),
  modifie_par TEXT
);

-- Commentaires : une ligne par commentaire, reliée à sa fiche
CREATE TABLE IF NOT EXISTS commentaires (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  fiche_id     TEXT NOT NULL REFERENCES fiches(id) ON DELETE CASCADE,
  auteur_email TEXT NOT NULL,
  texte        TEXT NOT NULL,
  cree_le      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_fiches_categorie ON fiches(categorie);
CREATE INDEX IF NOT EXISTS idx_fiches_modifie_le ON fiches(modifie_le);
CREATE INDEX IF NOT EXISTS idx_commentaires_fiche ON commentaires(fiche_id, cree_le);
