// Worker API claude-prime-api
//   R2 (binding OUTILS) : copie complète de chaque fiche  -> fiches/<id>.json
//   D1 (binding DB)     : index des fiches (recherche, tri, pagination) + commentaires
//   Access              : seules les personnes autorisées peuvent écrire
//   Turnstile           : protège l'ajout de commentaires contre les robots

import { accessConfigure, verifierAccess } from "./access.js";
import { verifierTurnstile } from "./turnstile.js";
import { FICHES_INITIALES } from "./fiches-initiales.js";

const PAGE_EDITION = "/edition/outils.html";
const PAR_PAGE = 10;
const TRIS = {
  nom: "nom COLLATE NOCASE ASC",
  recent: "modifie_le DESC",
  categorie: "categorie COLLATE NOCASE ASC, nom COLLATE NOCASE ASC",
};

function json(donnees, statut = 200) {
  return new Response(JSON.stringify(donnees), {
    status: statut,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function nettoyer(texte, max) {
  return String(texte ?? "").trim().slice(0, max);
}

// ---------- R2 ----------

async function lireToutesLesFiches(env) {
  const fiches = {};
  let curseur;
  do {
    const liste = await env.OUTILS.list({ prefix: "fiches/", cursor: curseur });
    for (const objet of liste.objects) {
      const contenu = await env.OUTILS.get(objet.key);
      if (contenu) {
        const fiche = await contenu.json();
        fiches[fiche.id] = fiche;
      }
    }
    curseur = liste.truncated ? liste.cursor : undefined;
  } while (curseur);
  return fiches;
}

async function indexerDansD1(env, fiche) {
  if (!env.DB) return;
  await env.DB.prepare(
    `INSERT INTO fiches (id, nom, description, categorie, url, version, modifie_le, modifie_par)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
     ON CONFLICT(id) DO UPDATE SET nom = ?2, description = ?3, categorie = ?4, url = ?5,
       version = ?6, modifie_le = ?7, modifie_par = ?8`
  )
    .bind(fiche.id, fiche.nom, fiche.description, fiche.categorie, fiche.url,
      fiche.version, fiche.modifieLe, fiche.modifiePar ?? null)
    .run();
}

// Première connexion autorisée : on copie les fiches de départ dans R2 et D1.
async function initialiserSiVide(env) {
  const existant = await env.OUTILS.list({ prefix: "fiches/", limit: 1 });
  if (existant.objects.length > 0) return 0;
  const maintenant = new Date().toISOString();
  for (const base of FICHES_INITIALES) {
    const fiche = { ...base, version: 1, modifieLe: maintenant, modifiePar: null };
    await env.OUTILS.put(`fiches/${fiche.id}.json`, JSON.stringify(fiche), {
      httpMetadata: { contentType: "application/json" },
    });
    await indexerDansD1(env, fiche);
  }
  return FICHES_INITIALES.length;
}

// ---------- Routes ----------

async function routeEtat(request, env) {
  const acces = await verifierAccess(request, env);
  const reponse = {
    ecriture: acces.ok,
    edition: PAGE_EDITION,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY || null,
  };
  if (acces.ok) {
    reponse.email = acces.email;
    reponse.initialisees = await initialiserSiVide(env);
  } else if (accessConfigure(env)) {
    reponse.raison = acces.raison;
  }
  return json(reponse);
}

async function routeModifierFiche(request, env, id) {
  const acces = await verifierAccess(request, env);
  if (!acces.ok) return json({ erreur: acces.raison }, 401);

  const cle = `fiches/${id}.json`;
  const actuel = await env.OUTILS.get(cle);
  if (!actuel) return json({ erreur: "Fiche introuvable" }, 404);
  const fiche = await actuel.json();

  let corps;
  try {
    corps = await request.json();
  } catch {
    return json({ erreur: "Corps JSON invalide" }, 400);
  }

  const nouvelle = {
    ...fiche,
    nom: nettoyer(corps.nom ?? fiche.nom, 120) || fiche.nom,
    description: nettoyer(corps.description ?? fiche.description, 1000),
    categorie: nettoyer(corps.categorie ?? fiche.categorie, 60),
    version: (fiche.version || 1) + 1,
    modifieLe: new Date().toISOString(),
    modifiePar: acces.email,
  };
  await env.OUTILS.put(cle, JSON.stringify(nouvelle), {
    httpMetadata: { contentType: "application/json" },
  });
  await indexerDansD1(env, nouvelle);
  return json({ ok: true, fiche: nouvelle });
}

async function routeRecherche(url, env) {
  if (!env.DB) return json({ erreur: "Base D1 non reliée" }, 503);
  const q = nettoyer(url.searchParams.get("q"), 100);
  const categorie = nettoyer(url.searchParams.get("categorie"), 60);
  const tri = TRIS[url.searchParams.get("tri")] || TRIS.nom; // liste blanche : jamais de texte utilisateur dans ORDER BY
  const page = Math.max(1, parseInt(url.searchParams.get("page"), 10) || 1);

  const conditions = [];
  const params = [];
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`(nom LIKE ?${params.length} OR description LIKE ?${params.length})`);
  }
  if (categorie) {
    params.push(categorie);
    conditions.push(`categorie = ?${params.length}`);
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = await env.DB.prepare(`SELECT COUNT(*) AS n FROM fiches ${where}`).bind(...params).first();
  params.push(PAR_PAGE, (page - 1) * PAR_PAGE);
  const { results } = await env.DB.prepare(
    `SELECT f.*, (SELECT COUNT(*) FROM commentaires c WHERE c.fiche_id = f.id) AS nb_commentaires
     FROM fiches f ${where} ORDER BY ${tri} LIMIT ?${params.length - 1} OFFSET ?${params.length}`
  ).bind(...params).all();

  return json({ page, parPage: PAR_PAGE, total: total?.n ?? 0, fiches: results });
}

async function routeCategories(env) {
  if (!env.DB) return json({ erreur: "Base D1 non reliée" }, 503);
  const { results } = await env.DB.prepare(
    "SELECT categorie, COUNT(*) AS n FROM fiches GROUP BY categorie ORDER BY categorie"
  ).all();
  return json({ categories: results });
}

async function routeListerCommentaires(url, env) {
  if (!env.DB) return json({ erreur: "Base D1 non reliée" }, 503);
  const ficheId = nettoyer(url.searchParams.get("fiche"), 40);
  if (!ficheId) return json({ erreur: "Paramètre fiche manquant" }, 400);
  const { results } = await env.DB.prepare(
    "SELECT id, auteur_email, texte, cree_le FROM commentaires WHERE fiche_id = ?1 ORDER BY cree_le DESC LIMIT 50"
  ).bind(ficheId).all();
  return json({ commentaires: results });
}

async function routeAjouterCommentaire(request, env) {
  // 1. Vigile anti-robots en premier : sans jeton valide, on ne touche pas à la base.
  let corps;
  try {
    corps = await request.formData();
  } catch {
    return json({ erreur: "Formulaire invalide" }, 400);
  }
  const turnstile = await verifierTurnstile(
    corps.get("cf-turnstile-response"), request.headers.get("CF-Connecting-IP"), env
  );
  if (!turnstile.ok) return json({ erreur: turnstile.raison, codes: turnstile.codes }, 403);

  // 2. Identité via Access
  const acces = await verifierAccess(request, env);
  if (!acces.ok) return json({ erreur: acces.raison }, 401);

  if (!env.DB) return json({ erreur: "Base D1 non reliée" }, 503);
  const ficheId = nettoyer(corps.get("fiche"), 40);
  const texte = nettoyer(corps.get("texte"), 2000);
  if (!ficheId || !texte) return json({ erreur: "Fiche et texte obligatoires" }, 400);

  // 3. Requête préparée : le texte n'est jamais collé dans le SQL
  await env.DB.prepare(
    "INSERT INTO commentaires (fiche_id, auteur_email, texte) VALUES (?1, ?2, ?3)"
  ).bind(ficheId, acces.email, texte).run();
  return json({ ok: true }, 201);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const methode = request.method;

    try {
      if (pathname === "/api/etat" && methode === "GET") return await routeEtat(request, env);
      if (pathname === "/api/fiches" && methode === "GET") {
        return json({ fiches: await lireToutesLesFiches(env) });
      }
      const m = pathname.match(/^\/api\/fiches\/([a-z0-9-]{1,40})$/);
      if (m && methode === "PUT") return await routeModifierFiche(request, env, m[1]);
      if (pathname === "/api/recherche" && methode === "GET") return await routeRecherche(url, env);
      if (pathname === "/api/categories" && methode === "GET") return await routeCategories(env);
      if (pathname === "/api/commentaires" && methode === "GET") return await routeListerCommentaires(url, env);
      if (pathname === "/api/commentaires" && methode === "POST") return await routeAjouterCommentaire(request, env);
      if (pathname.startsWith("/api/")) return json({ erreur: "Route inconnue" }, 404);

      if (pathname === "/" || pathname === "/edition" || pathname === "/edition/") {
        return Response.redirect(new URL(PAGE_EDITION, url), 302);
      }
      if (env.ASSETS) return env.ASSETS.fetch(request);
      return new Response("Introuvable", { status: 404 });
    } catch (e) {
      console.error(e);
      return json({ erreur: "Erreur interne", detail: String(e.message || e) }, 500);
    }
  },
};
