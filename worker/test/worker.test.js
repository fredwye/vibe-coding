import { test } from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { verifierAccess, _viderCacheCles } from "../src/access.js";

// --- Faux R2 en mémoire ---
function fauxR2() {
  const objets = new Map();
  return {
    objets,
    async list({ prefix = "", limit } = {}) {
      let keys = [...objets.keys()].filter((k) => k.startsWith(prefix)).sort();
      if (limit) keys = keys.slice(0, limit);
      return { objects: keys.map((key) => ({ key })), truncated: false };
    },
    async get(key) {
      if (!objets.has(key)) return null;
      const v = objets.get(key);
      return { json: async () => JSON.parse(v) };
    },
    async put(key, v) { objets.set(key, v); },
  };
}

// --- Faux D1 qui enregistre les requêtes et paramètres liés ---
function fauxD1() {
  const appels = [];
  return {
    appels,
    prepare(sql) {
      const stmt = { sql, params: [] };
      return {
        bind(...p) { stmt.params = p; return this; },
        async run() { appels.push(stmt); return { success: true }; },
        async all() { appels.push(stmt); return { results: [] }; },
        async first() { appels.push(stmt); return { n: 0 }; },
      };
    },
  };
}

const req = (chemin, init) => new Request("https://test.workers.dev" + chemin, init);

test("/api/etat sans Access : écriture désactivée", async () => {
  const rep = await worker.fetch(req("/api/etat"), { OUTILS: fauxR2() });
  assert.equal(rep.status, 200);
  assert.deepEqual(await rep.json(), { ecriture: false, edition: "/edition/outils.html", turnstileSiteKey: null });
});

test("/api/fiches sur un bucket vide renvoie {fiches:{}}", async () => {
  const rep = await worker.fetch(req("/api/fiches"), { OUTILS: fauxR2() });
  assert.deepEqual(await rep.json(), { fiches: {} });
});

test("PUT /api/fiches/:id sans jeton Access : 401", async () => {
  const env = { OUTILS: fauxR2(), ACCESS_TEAM_DOMAIN: "https://x.cloudflareaccess.com", ACCESS_AUD: "aud" };
  const rep = await worker.fetch(req("/api/fiches/outil-001", { method: "PUT", body: "{}" }), env);
  assert.equal(rep.status, 401);
});

test("POST /api/commentaires sans jeton Turnstile : 403 et aucune requête SQL", async () => {
  const db = fauxD1();
  const fd = new FormData();
  fd.append("fiche", "outil-001");
  fd.append("texte", "spam");
  const rep = await worker.fetch(req("/api/commentaires", { method: "POST", body: fd }),
    { OUTILS: fauxR2(), DB: db, TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA" });
  assert.equal(rep.status, 403);
  assert.equal(db.appels.length, 0);
});

test("Recherche : le texte utilisateur passe par .bind(), jamais dans le SQL", async () => {
  const db = fauxD1();
  const attaque = "'; DROP TABLE fiches; --";
  const rep = await worker.fetch(req("/api/recherche?q=" + encodeURIComponent(attaque) + "&tri=nimportequoi"), { DB: db });
  assert.equal(rep.status, 200);
  for (const appel of db.appels) assert.ok(!appel.sql.includes("DROP TABLE"));
  assert.ok(db.appels.some((a) => a.params.includes(`%${attaque}%`)));
  assert.ok(db.appels[1].sql.includes("ORDER BY nom COLLATE NOCASE ASC")); // tri inconnu -> tri par défaut
});

// --- Access : jeton signé avec une vraie clé RSA générée pour le test ---
async function jetonSigne(charge, kid = "k1") {
  const paire = await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true, ["sign", "verify"]);
  const jwk = { ...(await crypto.subtle.exportKey("jwk", paire.publicKey)), kid };
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const corps = `${b64({ alg: "RS256", kid })}.${b64(charge)}`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", paire.privateKey, new TextEncoder().encode(corps));
  return { jeton: `${corps}.${Buffer.from(sig).toString("base64url")}`, jwk };
}

test("Access : jeton valide accepté, mauvaise audience refusée", async () => {
  const env = { ACCESS_TEAM_DOMAIN: "https://equipe.cloudflareaccess.com", ACCESS_AUD: "bonne-aud" };
  const base = { iss: env.ACCESS_TEAM_DOMAIN, exp: Math.floor(Date.now() / 1000) + 600, email: "Fred@Exemple.fr" };

  const bon = await jetonSigne({ ...base, aud: ["bonne-aud"] });
  _viderCacheCles();
  const fetchCerts = async () => new Response(JSON.stringify({ keys: [bon.jwk] }));
  const r1 = await verifierAccess(req("/", { headers: { "Cf-Access-Jwt-Assertion": bon.jeton } }), env, fetchCerts);
  assert.deepEqual(r1, { ok: true, email: "fred@exemple.fr" });

  const mauvais = await jetonSigne({ ...base, aud: ["autre-app"] });
  _viderCacheCles();
  const r2 = await verifierAccess(req("/", { headers: { "Cf-Access-Jwt-Assertion": mauvais.jeton } }), env,
    async () => new Response(JSON.stringify({ keys: [mauvais.jwk] })));
  assert.equal(r2.ok, false);
  assert.match(r2.raison, /autre application/);
});
