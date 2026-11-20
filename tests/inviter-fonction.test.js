/* Fonction « inviter » (ouverture de l'espace d'un intervenant), Supabase et Brevo simulés.
   node tests/inviter-fonction.test.js <chemin du dépôt> */
const path = require("path");
const DEPOT = process.argv[2];
process.env.SUPABASE_SECRET_KEY = "sb_secret_essai";
process.env.BREVO_API_KEY = "brevo-essai";
process.env.SITE_URL = "https://artdive.app";

let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log("OK     " + n); } else { ko++; console.log("ÉCHEC  " + n + (d ? "  → " + String(d).slice(0, 300) : "")); } };

const I = "11111111-1111-1111-1111-111111111111", U_NEUF = "22222222-2222-2222-2222-222222222222", U_ADMIN = "33333333-3333-3333-3333-333333333333";
let etat;
function reinit(o) {
  etat = Object.assign({ appels: [], profils: [{ user_id: U_ADMIN, role: "admin", intervenant_id: null }], email: "guide@exemple.invalid",
    sessionUser: U_ADMIN, compteExiste: false, userLien: U_NEUF, brevoOk: true }, o || {});
}
const rep = (status, body) => ({ ok: status < 300, status, text: async () => body === undefined ? "" : JSON.stringify(body), json: async () => body });
global.fetch = async (url, opts = {}) => {
  const u = new URL(url); const m = opts.method || "GET"; const corps = opts.body ? JSON.parse(opts.body) : null;
  etat.appels.push({ m, chemin: u.pathname + u.search, corps, h: opts.headers || {} });
  if (u.pathname === "/auth/v1/user") return (opts.headers.Authorization === "Bearer jeton-valide-de-session-0123456789") ? rep(200, { id: etat.sessionUser, email: "x@exemple.invalid" }) : rep(401, {});
  if (u.pathname === "/rest/v1/profils" && m === "GET") {
    const uid = (u.searchParams.get("user_id") || "").replace("eq.", ""), iid = (u.searchParams.get("intervenant_id") || "").replace("eq.", "");
    return rep(200, etat.profils.filter((p) => (uid && p.user_id === uid) || (iid && p.intervenant_id === iid)));
  }
  if (u.pathname === "/rest/v1/profils" && m === "POST") { etat.profils.push(corps); return rep(201); }
  if (u.pathname === "/rest/v1/intervenants") return rep(200, [{ id: I, nom: "Sylvain Lesecq" }]);
  if (u.pathname === "/rest/v1/intervenants_contacts") return rep(200, etat.email ? [{ email: etat.email }] : []);
  if (u.pathname === "/auth/v1/admin/users") return etat.compteExiste ? rep(422, { error_code: "email_exists" }) : rep(200, { id: U_NEUF });
  if (u.pathname === "/auth/v1/admin/generate_link") return rep(200, { id: etat.userLien, email: corps.email, action_link: "https://mepcwassmoespzzsdjxf.supabase.co/auth/v1/verify?token=abc&type=magiclink&redirect_to=" + encodeURIComponent(corps.redirect_to) });
  if (u.hostname === "api.brevo.com") return etat.brevoOk ? rep(201, { messageId: "m" }) : rep(500, {});
  // File des emails (22/11) : l'email d'accès est mis en file puis envoyé aussitôt.
  etat.envois = etat.envois || [];
  if (u.pathname === "/rest/v1/envois" && m === "POST") { const e = Object.assign({ id: etat.envois.length + 1, statut: "a_envoyer" }, corps); etat.envois.push(e); return rep(201, [e]); }
  if (u.pathname === "/rest/v1/envois" && m === "GET") return rep(200, etat.envois.filter((e) => "eq." + e.id === u.searchParams.get("id")));
  if (u.pathname === "/rest/v1/rpc/envois_a_traiter") { const lot = etat.envois.filter((e) => e.statut === "a_envoyer"); lot.forEach((e) => { e.statut = "en_cours"; }); return rep(200, lot); }
  if (u.pathname === "/rest/v1/rpc/envoi_resultat") { const e = etat.envois.find((x) => x.id === corps.p_id); if (e) e.statut = corps.p_ok ? "envoye" : "echec"; return rep(200, null); }
  if (u.pathname === "/rest/v1/rpc/connexion_lien_creer") { etat.liens = (etat.liens || []).concat([corps]); return rep(200, null); }
  return rep(404, {});
};
const { handler } = require(path.join(DEPOT, "netlify/functions/inviter.js"));
const appeler = (corps, jeton = "jeton-valide-de-session-0123456789") =>
  handler({ httpMethod: "POST", headers: jeton ? { authorization: "Bearer " + jeton } : {}, body: JSON.stringify(corps) })
    .then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));

(async () => {
  reinit();
  let r = await appeler({ intervenant_id: I });
  v("admin invite un nouvel intervenant : 200", r.status === 200, JSON.stringify(r));
  v("compte créé avec email confirmé", etat.appels.some((a) => a.chemin === "/auth/v1/admin/users" && a.corps.email === "guide@exemple.invalid" && a.corps.email_confirm === true));
  v("lien de connexion directe gardé en base par son empreinte seulement", etat.liens && etat.liens.length === 1 && etat.liens[0].p_email === "guide@exemple.invalid" && /^[0-9a-f]{64}$/.test(etat.liens[0].p_jeton_hash));
  v("profil intervenant relié à la fiche", etat.profils.some((p) => p.user_id === U_NEUF && p.role === "intervenant" && p.intervenant_id === I));
  const mail = etat.appels.find((a) => a.chemin.startsWith("/v3/smtp/email"));
  v("email d'accès envoyé avec le lien de connexion (7 jours) vers l'espace", mail && mail.corps.to[0].email === "guide@exemple.invalid" &&
    /https:\/\/artdive\.app\/#connexion=[A-Za-z0-9_-]{43}&amp;vers=espace/.test(mail.corps.htmlContent) && mail.corps.htmlContent.includes("Sylvain Lesecq") && r.body.notifie === true, mail && mail.corps.htmlContent);
  v("clé secrète jamais envoyée à Brevo", mail && !JSON.stringify(mail).includes("sb_secret_essai"));

  reinit({ compteExiste: true, profils: [{ user_id: U_ADMIN, role: "admin" }, { user_id: U_NEUF, role: "intervenant", intervenant_id: I }] });
  r = await appeler({ intervenant_id: I });
  v("réinvitation (compte déjà ouvert) : nouveau lien, pas de doublon de profil", r.status === 200 && etat.profils.length === 2 && !etat.appels.some((a) => a.chemin === "/rest/v1/profils" && a.m === "POST"), JSON.stringify(r));

  reinit({ sessionUser: U_NEUF, profils: [{ user_id: U_NEUF, role: "intervenant", intervenant_id: I }] });
  r = await appeler({ intervenant_id: I });
  v("un intervenant ne peut pas inviter : 403", r.status === 403 && !etat.appels.some((a) => a.chemin.includes("admin/")));
  reinit();
  r = await appeler({ intervenant_id: I }, null);
  v("sans session : 403", r.status === 403);
  r = await appeler({ intervenant_id: I }, "jeton-faux-mais-bien-forme-000000");
  v("session invalide : 403", r.status === 403);

  reinit({ email: null });
  r = await appeler({ intervenant_id: I });
  v("pas d'email de contact : refus clair, aucun compte créé", r.status === 400 && r.body.error === "EMAIL_MANQUANT" && !etat.appels.some((a) => a.chemin.includes("admin/")));
  reinit({ userLien: U_ADMIN, compteExiste: true });
  r = await appeler({ intervenant_id: I });
  v("l'email est celui de l'admin : refus, rôle admin intact", r.status === 409 && r.body.error === "COMPTE_ADMIN" && etat.profils.length === 1 && !etat.appels.some((a) => a.chemin.startsWith("/v3/")));
  reinit({ profils: [{ user_id: U_ADMIN, role: "admin" }, { user_id: "44444444-4444-4444-4444-444444444444", role: "intervenant", intervenant_id: I }] });
  r = await appeler({ intervenant_id: I });
  v("fiche déjà reliée à un autre compte : refus", r.status === 409 && r.body.error === "FICHE_DEJA_RELIEE");
  reinit();
  r = await appeler({ intervenant_id: "pas-un-uuid" });
  v("identifiant invalide : 400", r.status === 400);
  reinit({ brevoOk: false });
  r = await appeler({ intervenant_id: I });
  v("Brevo en panne : accès ouvert quand même, « notification non envoyée » (reste en file)", r.status === 200 && r.body.notifie === false &&
    etat.profils.some((p) => p.user_id === U_NEUF) && etat.envois[0].statut === "echec");

  console.log("\n" + ok + " réussis, " + ko + " en échec"); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
