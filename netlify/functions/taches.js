/* ============================================================
   FONCTION NETLIFY PLANIFIÉE — taches (toutes les 15 minutes,
   voir netlify.toml)
   1. libère les places bloquées dont le paiement n'a pas abouti ;
   2. annule les séances dont le minimum n'est pas atteint 48 h avant ;
   3. prépare les rappels 36 h avant ;
   4. traite les files : remboursements, frais, emails.
   Tout est sans doublon : relancer la tâche ne refait rien deux fois.
   Ne renvoie que des totaux (aucune donnée personnelle).
   ============================================================ */

const { json, rpc } = require("../lib/commun");
const { toutTraiter } = require("../lib/reservations");

exports.handler = async () => {
  const bilan = {};
  for (const [nom, fn] of [["liberees", "liberer_reservations_expirees"], ["minimums", "verifier_minimums"],
                           ["rappels", "preparer_rappels"]]) {
    try { bilan[nom] = await rpc(fn, {}); } catch (e) { bilan[nom] = { erreur: e.message }; console.error("taches", fn, e.message); }
  }
  Object.assign(bilan, await toutTraiter());
  console.log("taches", JSON.stringify(bilan));
  return json(200, bilan);
};
