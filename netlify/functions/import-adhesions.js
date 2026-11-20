/* ============================================================
   FONCTION NETLIFY — import-adhesions
   Reprend une fois les adhésions déjà payées sur Stripe (décision du
   21/11 : la liste des adhérents est celle des paiements d'adhésion) :
   - tous les abonnements « Adhésion annuelle » et « Bienfaiteur » ;
   - tous les paiements ponctuels d'adhésion.
   Fin de chaque adhésion : la période réellement payée (abonnement) ou
   le paiement + 12 mois (ponctuel) ; si cette date est déjà passée,
   l'ancien adhérent est importé ACTIF jusqu'au 31/12/2026, le temps de
   passer à l'abonnement. Chaque adhérent reçoit son numéro (registre).
   Peut être relancée sans créer de doublons.

   Protégée par un code à usage unique (30 min) que l'association crée
   dans Supabase > SQL Editor :  select public.code_import_creer();
   puis : https://artdive.app/.netlify/functions/import-adhesions?code=CODE

   Ne renvoie que des totaux, jamais de noms ni d'emails.
   ============================================================ */

const {
  LIENS_PONCTUELS, json, sha256hex, rpc, stripe,
  formuleAbonnement, enregistrerAbonnement, enregistrerSession, periode,
} = require("../lib/commun");

/** Fin minimale des adhésions importées (décision du 21/11). */
const FIN_ANCIENS = "2026-12-31T23:59:59+01:00";

async function* tous(chemin, params) {
  let apres = null;
  for (;;) {
    const page = await stripe(chemin, Object.assign({ limit: "100" }, params, apres ? { starting_after: apres } : {}));
    for (const o of page.data) yield o;
    if (!page.has_more || !page.data.length) return;
    apres = page.data[page.data.length - 1].id;
  }
}

exports.handler = async (event) => {
  const code = String((event.queryStringParameters || {}).code || "");
  if (!/^[0-9a-f]{64}$/.test(code)) return json(400, { error: "Code manquant ou invalide" });

  try {
    const ok = await rpc("code_import_utiliser", { p_code_hash: sha256hex(code) });
    if (!ok) return json(403, { error: "Code inconnu, déjà utilisé ou expiré" });

    const totaux = { abonnements: 0, ponctuels: 0, ignores: 0, erreurs: 0, prolongees: 0 };
    const importees = [];

    for await (const sub of tous("subscriptions", { status: "all", "expand[]": "data.customer" })) {
      if (!formuleAbonnement(sub)) continue;
      if (sub.status === "incomplete" || sub.status === "incomplete_expired") { totaux.ignores++; continue; }   // jamais payé
      try {
        const r = await enregistrerAbonnement(sub);
        if (r) { totaux.abonnements++; importees.push(r.id); } else totaux.ignores++;
      } catch (e) { totaux.erreurs++; console.error("import abonnement", sub.id, e.message); }
    }

    for (const lien of LIENS_PONCTUELS) {
      for await (const s of tous("checkout/sessions", { payment_link: lien, status: "complete" })) {
        try {
          const r = await enregistrerSession(s);
          if (r) { totaux.ponctuels++; importees.push(r.id); } else totaux.ignores++;
        } catch (e) { totaux.erreurs++; console.error("import ponctuel", s.id, e.message); }
      }
    }

    // Anciens adhérents dont l'adhésion est déjà finie : actifs jusqu'au 31/12/2026.
    if (importees.length) {
      totaux.prolongees = await rpc("prolonger_anciens_adherents", { p_ids: importees, p_jusqua: FIN_ANCIENS });
    }
    return json(200, Object.assign({ fait: true }, totaux));
  } catch (e) {
    console.error("import-adhesions", e.message);
    return json(500, { error: "Import impossible : " + e.message });
  }
};
