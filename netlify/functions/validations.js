/* ============================================================
   FONCTION NETLIFY — validations (administration E12, lot du 22/11)
   POST { action, id, motif? }, avec l'en-tête Authorization: Bearer
   <session> de l'administratrice connectée. Réservé à l'admin : vérifié
   ici à partir de la session, pas sur la parole de l'app.

   - "candidature_accepter" : crée (ou retrouve) le compte de connexion du
     candidat, puis la base crée sa fiche d'intervenant, son profil, son
     contact et met en file l'email d'accès (lien de connexion 7 jours).
   - "candidature_refuser"  { motif } : email au candidat avec le motif.
   - "experience_valider"   : en ligne, email E9.7 « Créez votre première
     séance » avec un lien de connexion directe.
   - "experience_refuser"   { motif } : email à l'intervenant avec le motif.
   - "intervenant_supprimer": refusé si une séance à venir a des inscrits ;
     sinon fiche supprimée, expériences retirées, comptes de connexion
     supprimés.

   Les emails partent aussitôt ; s'ils échouent, la décision reste
   enregistrée et l'administration affiche « notification non envoyée ».
   ============================================================ */

const { json, rpc, table, authAdmin, appelant, emailValide, compteDeConnexion } = require("../lib/commun");
const { traiterEnvois } = require("../lib/reservations");

const uuidValide = (x) => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);
const motifDe = (m) => String(m == null ? "" : m).trim().slice(0, 1000) || null;

/** Envoie tout de suite l'email mis en file et dit s'il est parti. */
async function envoyer(envoiId) {
  if (!envoiId) return false;
  await traiterEnvois(10).catch((e) => console.error("validations envoi", e.message));
  const v = (await table("GET", "envois?select=statut&id=eq." + envoiId).catch(() => []))[0];
  return !!(v && v.statut === "envoye");
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST attendu" });
  let p;
  try { p = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Corps invalide" }); }

  try {
    const qui = await appelant(event);
    if (!qui || qui.role !== "admin") return json(403, { error: "RESERVE_ADMIN" });
    if (!uuidValide(p.id)) return json(400, { error: "PARAMETRES" });

    if (p.action === "candidature_accepter") {
      const c = (await table("GET", "candidatures?select=email,statut&id=eq." + p.id))[0];
      if (!c) return json(404, { error: "INTROUVABLE" });
      const email = String(c.email || "").trim().toLowerCase();
      if (!emailValide(email)) return json(400, { error: "EMAIL" });
      const userId = await compteDeConnexion(email);
      const r = await rpc("accepter_candidature", { p_id: p.id, p_user_id: userId, p_acteur: qui.id });
      return json(200, { ok: true, email, deja: !!r.deja, notifie: r.deja ? true : await envoyer(r.envoi_id) });
    }
    if (p.action === "candidature_refuser") {
      const r = await rpc("refuser_candidature", { p_id: p.id, p_motif: motifDe(p.motif), p_acteur: qui.id });
      return json(200, { ok: true, email: r.email, notifie: await envoyer(r.envoi_id) });
    }
    if (p.action === "experience_valider") {
      const r = await rpc("valider_experience", { p_id: p.id, p_acteur: qui.id });
      return json(200, { ok: true, email: r.email, notifie: await envoyer(r.envoi_id) });
    }
    if (p.action === "experience_refuser") {
      const r = await rpc("refuser_experience", { p_id: p.id, p_motif: motifDe(p.motif), p_acteur: qui.id });
      return json(200, { ok: true, email: r.email, notifie: await envoyer(r.envoi_id) });
    }
    if (p.action === "intervenant_supprimer") {
      let r;
      try { r = await rpc("supprimer_intervenant", { p_id: p.id, p_acteur: qui.id }); }
      catch (e) {
        if (/SEANCES_AVEC_INSCRITS/.test(e.message)) return json(409, { error: "SEANCES_AVEC_INSCRITS" });
        if (/INTERVENANT_INTROUVABLE/.test(e.message)) return json(404, { error: "INTROUVABLE" });
        throw e;
      }
      // Comptes de connexion de l'intervenant : supprimés (jamais celui de l'admin qui appelle).
      for (const id of r.comptes || []) {
        if (id === qui.id) continue;
        const d = await authAdmin("DELETE", "admin/users/" + id);
        if (!d.ok && d.status !== 404) console.error("validations : compte non supprimé", d.status);
      }
      return json(200, { ok: true, experiences_retirees: r.experiences_retirees });
    }
    return json(400, { error: "Action inconnue" });
  } catch (e) {
    const code = /COMPTE_ADMIN|INDISPONIBLE|INTROUVABLE|PRIX_OU_PLACES_MANQUANTS|SANS_INTERVENANT/.exec(e.message || "");
    if (code) return json(409, { error: code[0] });
    console.error("validations", p && p.action, e.message);
    return json(500, { error: "ERREUR" });
  }
};
