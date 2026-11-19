/* ============================================================
   PARCOURS AUTOGUIDÉS (partie 3) : outils partagés par la fonction
   « parcours » et le webhook Stripe.
   Le jeton d'accès (64 caractères) n'est jamais en base : seule son
   empreinte SHA-256 l'est (acces.jeton_hash). Il voyage dans les
   métadonnées de la session Stripe, pour que le webhook puisse envoyer
   le lien même si l'acheteur ne revient pas dans l'app.
   ============================================================ */

const crypto = require("crypto");
const { rpc, table, idDe, envoyerBrevo, sha256hex, SITE_URL } = require("./commun");
const { redigerAcces } = require("./emails");

const nouveauJetonHex = () => crypto.randomBytes(32).toString("hex");

/** Session Stripe payée → accès actif (une seule fois) et email avec le lien. Rend { jeton, acces } ou null. */
async function activerAcces(session) {
  const meta = session.metadata || {};
  if (!meta.acces_id || !/^[0-9a-f]{64}$/.test(meta.acces_jeton || "")) return null;
  if (session.payment_status !== "paid") return null;
  const r = await rpc("activer_acces", { p_acces_id: meta.acces_id, p_stripe_session_id: session.id,
    p_stripe_payment_intent: idDe(session.payment_intent), p_montant_centimes: session.amount_total });
  const a = (await table("GET", "acces?select=id,reference,email,langue,audioguide,montant_centimes,experience_id&id=eq." + meta.acces_id))[0];
  if (!a) return null;
  if (r && !r.deja_traite) await envoyerLienAcces(a, meta.acces_jeton).catch((e) => console.error("email accès :", e.message));
  return { jeton: meta.acces_jeton, acces: a };
}

async function envoyerLienAcces(a, jeton) {
  const e = (await table("GET", "experiences?select=titre,nb_etapes&id=eq." + a.experience_id))[0] || {};
  const l = ["fr", "en", "es"].includes(a.langue) ? a.langue : "fr";
  const m = redigerAcces({ langue: l, titre: (e.titre && (e.titre[l] || e.titre.fr)) || "ArtDive", etapes: e.nb_etapes,
    lien: SITE_URL + "/#parcours=" + jeton, reference: a.reference, montant: a.montant_centimes, audioguide: a.audioguide });
  await envoyerBrevo(a.email, m, ["parcours"]);
  await table("PATCH", "acces?id=eq." + a.id, { lien_envoye_le: new Date().toISOString() }, { Prefer: "return=minimal" });
}

/** Accès actif correspondant à un jeton, ou null. */
async function accesParJeton(jeton) {
  if (!/^[0-9a-f]{64}$/.test(String(jeton || ""))) return null;
  return (await table("GET", "acces?select=id,reference,email,langue,audioguide,montant_centimes,progression,experience_id,statut&statut=eq.actif&jeton_hash=eq." + sha256hex(jeton)))[0] || null;
}

/** Distance en mètres entre deux points (formule de haversine). */
function distanceM(lat1, lng1, lat2, lng2) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLng = (lng2 - lng1) * r;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(x));
}

module.exports = { nouveauJetonHex, activerAcces, envoyerLienAcces, accesParJeton, distanceM };
