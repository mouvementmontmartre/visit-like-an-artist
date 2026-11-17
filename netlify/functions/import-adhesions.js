/* ============================================================
   FONCTION NETLIFY — import-adhesions
   Reprend une fois les adhésions déjà payées sur Stripe :
   - les abonnements « Adhésion à l'année » et « Bienfaiteur », actifs
     ou dont la période payée n'est pas finie ;
   - les paiements ponctuels d'adhésion de moins d'un an.
   Peut être relancée sans créer de doublons.

   Protégée par un code à usage unique (30 min) que l'association crée
   dans Supabase > SQL Editor :  select public.code_import_creer();
   puis : https://montmartre.app/.netlify/functions/import-adhesions?code=CODE

   Ne renvoie que des totaux, jamais de noms ni d'emails.
   ============================================================ */

const {
  LIENS_PONCTUELS, json, sha256hex, rpc, stripe,
  formuleAbonnement, enregistrerAbonnement, enregistrerSession, periode,
} = require("../lib/commun");

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

    const totaux = { abonnements: 0, ponctuels: 0, ignores: 0, erreurs: 0 };
    const maintenant = Date.now() / 1000;

    for await (const sub of tous("subscriptions", { status: "all", "expand[]": "data.customer" })) {
      if (!formuleAbonnement(sub)) continue;
      const fin = (sub.ended_at || (periode(sub).fin)) || 0;
      if (sub.status === "canceled" && fin < maintenant) { totaux.ignores++; continue; }
      try { (await enregistrerAbonnement(sub)) ? totaux.abonnements++ : totaux.ignores++; }
      catch (e) { totaux.erreurs++; console.error("import abonnement", sub.id, e.message); }
    }

    const depuis = String(Math.floor(maintenant - 366 * 24 * 3600));
    for (const lien of LIENS_PONCTUELS) {
      for await (const s of tous("checkout/sessions", { payment_link: lien, status: "complete", "created[gte]": depuis })) {
        try { (await enregistrerSession(s)) ? totaux.ponctuels++ : totaux.ignores++; }
        catch (e) { totaux.erreurs++; console.error("import ponctuel", s.id, e.message); }
      }
    }

    return json(200, Object.assign({ fait: true }, totaux));
  } catch (e) {
    console.error("import-adhesions", e.message);
    return json(500, { error: "Import impossible : " + e.message });
  }
};
