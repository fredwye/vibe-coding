// Vérification du jeton Cloudflare Access (en-tête Cf-Access-Jwt-Assertion).
// On ne se contente pas de la présence de l'en-tête : on vérifie la signature,
// l'audience (ACCESS_AUD), l'émetteur (ACCESS_TEAM_DOMAIN) et l'expiration.

let cacheCles = { domaine: null, cles: null, expire: 0 };

function b64urlEnOctets(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

function b64urlEnJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlEnOctets(s)));
}

export function accessConfigure(env) {
  return Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD);
}

function domaineEquipe(env) {
  return String(env.ACCESS_TEAM_DOMAIN).replace(/\/+$/, "");
}

async function clesPubliques(env, fetchFn) {
  const domaine = domaineEquipe(env);
  if (cacheCles.domaine === domaine && cacheCles.expire > Date.now()) return cacheCles.cles;
  const rep = await fetchFn(`${domaine}/cdn-cgi/access/certs`);
  if (!rep.ok) throw new Error("certs Access injoignables");
  const { keys } = await rep.json();
  cacheCles = { domaine, cles: keys, expire: Date.now() + 10 * 60 * 1000 };
  return keys;
}

/**
 * Renvoie { ok: true, email } si le jeton est valide, sinon { ok: false, raison }.
 */
export async function verifierAccess(request, env, fetchFn = fetch) {
  if (!accessConfigure(env)) return { ok: false, raison: "Access non configuré" };

  const jeton = request.headers.get("Cf-Access-Jwt-Assertion");
  if (!jeton) return { ok: false, raison: "Jeton Access absent" };

  const morceaux = jeton.split(".");
  if (morceaux.length !== 3) return { ok: false, raison: "Jeton Access mal formé" };

  let entete, charge;
  try {
    entete = b64urlEnJson(morceaux[0]);
    charge = b64urlEnJson(morceaux[1]);
  } catch {
    return { ok: false, raison: "Jeton Access illisible" };
  }

  const cles = await clesPubliques(env, fetchFn);
  const jwk = cles.find((k) => k.kid === entete.kid);
  if (!jwk || entete.alg !== "RS256") return { ok: false, raison: "Clé de signature inconnue" };

  const cle = await crypto.subtle.importKey(
    "jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]
  );
  const signatureOk = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5", cle, b64urlEnOctets(morceaux[2]),
    new TextEncoder().encode(`${morceaux[0]}.${morceaux[1]}`)
  );
  if (!signatureOk) return { ok: false, raison: "Signature Access invalide" };

  const audiences = Array.isArray(charge.aud) ? charge.aud : [charge.aud];
  if (!audiences.includes(env.ACCESS_AUD)) {
    return { ok: false, raison: "Accès non autorisé : jeton destiné à une autre application" };
  }
  if (charge.iss !== domaineEquipe(env)) return { ok: false, raison: "Émetteur Access inattendu" };
  if (!charge.exp || charge.exp * 1000 < Date.now()) return { ok: false, raison: "Session Access expirée" };
  if (!charge.email) return { ok: false, raison: "Jeton sans adresse e-mail" };

  return { ok: true, email: String(charge.email).toLowerCase() };
}

// Pour les tests uniquement
export function _viderCacheCles() {
  cacheCles = { domaine: null, cles: null, expire: 0 };
}
