/* Fonction « accepter » (email d'acceptation d'une demande privée ou d'une candidature), Supabase et Brevo simulés.
   node tests/accepter-fonction.test.js <chemin du dépôt> */
const path = require("path");
const DEPOT = process.argv[2];
process.env.SUPABASE_SECRET_KEY = "sb_secret_essai";
process.env.BREVO_API_KEY = "brevo-essai";

let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log("OK     " + n); } else { ko++; console.log("ÉCHEC  " + n + (d ? "  → " + String(d).slice(0, 300) : "")); } };

const D = "11111111-1111-1111-1111-111111111111", U_ADMIN = "33333333-3333-3333-3333-333333333333";
let etat;
const reinit = (o) => { etat = Object.assign({ appels: [], role: "admin", brevoOk: true,
  ligne: { id: D, nom: "Camille", email: "Camille@Exemple.invalid", langue: "en", statut: "nouvelle" } }, o || {}); };
const rep = (status, body) => ({ ok: status < 300, status, text: async () => body === undefined ? "" : JSON.stringify(body), json: async () => body });
global.fetch = async (url, opts = {}) => {
  const u = new URL(url); const m = opts.method || "GET"; const corps = opts.body ? JSON.parse(opts.body) : null;
  etat.appels.push({ m, chemin: u.pathname + u.search, corps });
  if (u.pathname === "/auth/v1/user") return opts.headers.Authorization === "Bearer jeton-valide-de-session-0123456789" ? rep(200, { id: U_ADMIN }) : rep(401, {});
  if (u.pathname === "/rest/v1/profils") return rep(200, [{ user_id: U_ADMIN, role: etat.role, intervenant_id: null }]);
  if (/^\/rest\/v1\/(demandes_groupes|candidatures)$/.test(u.pathname)) return m === "GET" ? rep(200, etat.ligne ? [etat.ligne] : []) : rep(204);
  if (u.hostname === "api.brevo.com") return etat.brevoOk ? rep(201, { messageId: "m" }) : rep(500, {});
  return rep(404, {});
};
const { handler } = require(path.join(DEPOT, "netlify/functions/accepter.js"));
const appeler = (corps, jeton = "jeton-valide-de-session-0123456789") =>
  handler({ httpMethod: "POST", headers: jeton ? { authorization: "Bearer " + jeton } : {}, body: JSON.stringify(corps) })
    .then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
const mail = () => (etat.appels.find((a) => a.chemin === "/v3/smtp/email") || {}).corps;
const patch = () => etat.appels.find((a) => a.m === "PATCH");

(async () => {
  reinit();
  let r = await appeler({ table: "demandes_groupes", id: D });
  v("demande acceptée : 200", r.status === 200, JSON.stringify(r));
  const e = mail();
  v("email à la personne, en minuscules, dans sa langue", e && e.to[0].email === "camille@exemple.invalid" && /accepted/.test(e.subject), e && e.subject);
  v("email avec les coordonnées de Lucie", e && /Lucie/.test(e.textContent) && /07 69 99 57 64/.test(e.textContent) && /mouvementmontmartre@gmail\.com/.test(e.textContent));
  v("demande passée « en cours »", patch() && patch().corps.statut === "en_cours");
  reinit({ ligne: { id: D, nom: "Paul", email: "paul@exemple.invalid", statut: "nouvelle" } });
  r = await appeler({ table: "candidatures", id: D });
  v("candidature : email en français et statut « acceptée »", r.status === 200 && /candidature/.test(mail().subject) && patch().corps.statut === "acceptee");
  reinit({ role: "intervenant" });
  r = await appeler({ table: "demandes_groupes", id: D });
  v("intervenant refusé, rien envoyé", r.status === 403 && !mail());
  reinit();
  r = await appeler({ table: "demandes_groupes", id: D }, null);
  v("sans session refusé", r.status === 403 && !mail());
  r = await appeler({ table: "profils", id: D });
  v("autre table refusée", r.status === 400 && !mail());
  r = await appeler({ table: "candidatures", id: "pas-un-id" });
  v("identifiant invalide refusé", r.status === 400);
  reinit({ ligne: null });
  r = await appeler({ table: "candidatures", id: D });
  v("demande introuvable : 404", r.status === 404);
  reinit({ brevoOk: false });
  r = await appeler({ table: "demandes_groupes", id: D });
  v("Brevo en panne : erreur et statut inchangé", r.status === 500 && !patch());
  console.log("\n" + ok + " réussis, " + ko + " en échec");
  process.exit(ko ? 1 : 0);
})();
