/* ============================================================
   FONCTION NETLIFY — accepter
   POST { table: "demandes_groupes" | "candidatures", id }, avec l'en-tête
   Authorization: Bearer <session> de l'administratrice.
   Envoie à la personne l'email d'acceptation avec les coordonnées de
   l'association, puis passe la demande « en cours » (candidature :
   « acceptée »). Réservé à l'admin, vérifié ici à partir de la session.
   ============================================================ */

const { json, table, appelant, envoyerBrevo, emailValide } = require("../lib/commun");
const { redigerAcceptation } = require("../lib/emails");

const TABLES = { demandes_groupes: { quoi: "demande", statut: "en_cours" }, candidatures: { quoi: "candidature", statut: "acceptee" } };
const uuidValide = (x) => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST attendu" });
  let p;
  try { p = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Corps invalide" }); }
  try {
    const qui = await appelant(event);
    if (!qui || qui.role !== "admin") return json(403, { error: "RESERVE_ADMIN" });
    const cible = TABLES[p.table];
    if (!cible || !uuidValide(p.id)) return json(400, { error: "Demande invalide" });
    const d = (await table("GET", p.table + "?select=*&id=eq." + p.id))[0];
    if (!d) return json(404, { error: "INTROUVABLE" });
    const email = String(d.email || "").trim().toLowerCase();
    if (!emailValide(email)) return json(400, { error: "EMAIL" });
    await envoyerBrevo(email, redigerAcceptation({ langue: d.langue, nom: d.nom, quoi: cible.quoi }), ["acceptation"]);
    await table("PATCH", p.table + "?id=eq." + p.id, { statut: cible.statut }, { Prefer: "return=minimal" });
    return json(200, { ok: true });
  } catch (e) {
    console.error("accepter :", e.message);
    return json(500, { error: "ERREUR" });
  }
};
