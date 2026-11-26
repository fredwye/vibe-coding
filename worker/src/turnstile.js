// Validation côté serveur du jeton Turnstile (on ne fait jamais confiance au client).
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifierTurnstile(jeton, ip, env, fetchFn = fetch) {
  if (!env.TURNSTILE_SECRET_KEY) {
    return { ok: false, raison: "Secret TURNSTILE_SECRET_KEY absent du Worker" };
  }
  if (!jeton) return { ok: false, raison: "Vérification anti-robot manquante" };

  const corps = new FormData();
  corps.append("secret", env.TURNSTILE_SECRET_KEY);
  corps.append("response", jeton);
  if (ip) corps.append("remoteip", ip);

  const rep = await fetchFn(SITEVERIFY, { method: "POST", body: corps });
  const resultat = await rep.json();
  if (!resultat.success) {
    return { ok: false, raison: "Vérification anti-robot refusée", codes: resultat["error-codes"] || [] };
  }
  return { ok: true };
}
