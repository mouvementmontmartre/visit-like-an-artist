/* Fonction « demande » (formulaires publics), Supabase et Brevo simulés.
   node tests/demande-fonction.test.js <chemin du dépôt> */
const path = require("path");
process.env.SUPABASE_SECRET_KEY = "sb_secret_essai"; process.env.BREVO_API_KEY = "brevo-essai";
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log("OK     " + n); } else { ko++; console.log("ÉCHEC  " + n + (d ? "  → " + String(d).slice(0, 300) : "")); } };
let st;
const rep = (status, body) => ({ ok: status < 300, status, text: async () => body === undefined ? "" : JSON.stringify(body), json: async () => body });
global.fetch = async (url, o = {}) => {
  const u = new URL(url), m = o.method || "GET", corps = o.body ? JSON.parse(o.body) : null;
  st.appels.push({ m, chemin: u.pathname + u.search, corps });
  if (u.hostname === "api.brevo.com") return rep(201, {});
  if (u.pathname === "/rest/v1/experiences") return rep(200, u.searchParams.get("slug") === "eq.circuit" ? [{ id: "x-1", titre: { fr: "Circuit des Peintres" } }] : []);
  // File des emails (22/11) : l'alerte est mise en file puis envoyée aussitôt.
  if (u.pathname === "/rest/v1/rpc/envois_a_traiter") { const lot = st.envois.filter((e) => !e.pris); lot.forEach((e) => { e.pris = true; }); return rep(200, lot); }
  if (u.pathname === "/rest/v1/rpc/envoi_resultat") return rep(200, null);
  if (u.pathname === "/rest/v1/envois" && m === "POST") { st.envois.push(Object.assign({ id: st.envois.length + 1 }, corps)); return rep(201); }
  if (m === "GET") return rep(200, Array(st.recentes).fill({ id: "a" }));
  if (m === "POST") { st.lignes.push({ table: u.pathname.split("/").pop(), corps }); return rep(201, [Object.assign({ id: "id-" + st.lignes.length }, corps)]); }
  return rep(404, {});
};
const { handler } = require(path.join(process.argv[2], "netlify/functions/demande.js"));
const envoyer = (corps) => { st = Object.assign({ appels: [], lignes: [], envois: [], recentes: 0 }, st && st.garder ? st : {});
  return handler({ httpMethod: "POST", body: JSON.stringify(Object.assign({ duree_ms: 8000 }, corps)) }).then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) })); };

(async () => {
  let r = await envoyer({ formulaire: "prive", type: "visite", experience: "circuit", personnes: 12, occasion: "anniversaire", periode: "un samedi",
    langue: "en", nom: "Camille", email: "Camille@Exemple.invalid", message: "<b>Bonjour</b>" });
  const l = st.lignes[0];
  v("demande privée enregistrée", r.status === 200 && l && l.table === "demandes_groupes" && l.corps.experience_id === "x-1" && l.corps.personnes === 12 &&
    l.corps.occasion === "anniversaire" && l.corps.langue === "en" && l.corps.email === "camille@exemple.invalid", JSON.stringify(st.lignes));
  const mail = st.appels.find((a) => a.chemin.startsWith("/v3/"));
  v("alerte à l'association, réponse vers la personne, texte échappé", mail && mail.corps.to[0].email === "mouvementmontmartre@gmail.com" &&
    mail.corps.replyTo.email === "camille@exemple.invalid" && mail.corps.htmlContent.includes("&lt;b&gt;Bonjour") && mail.corps.htmlContent.includes("Circuit des Peintres") &&
    mail.corps.htmlContent.includes("https://artdive.app/#espace=demandes"));
  v("aucun email envoyé à l'adresse saisie", !st.appels.some((a) => a.chemin.startsWith("/v3/") && a.corps.to[0].email.includes("camille")));
  r = await envoyer({ formulaire: "prive", experience: "inconnue", personnes: 9999, occasion: "piratage", nom: "A", email: "a@exemple.invalid" });
  v("valeurs hors liste ignorées", r.status === 200 && st.lignes[0].corps.experience_id === null && st.lignes[0].corps.personnes === null && st.lignes[0].corps.occasion === null && st.lignes[0].corps.type === "visite");
  r = await envoyer({ formulaire: "rejoindre", type: "artiste", nom: "Mayamore", email: "m@exemple.invalid", message: "Atelier de peinture" });
  v("candidature enregistrée", r.status === 200 && st.lignes[0].table === "candidatures" && st.lignes[0].corps.type === "artiste" && st.lignes[0].corps.origine === "rejoindre");
  r = await envoyer({ formulaire: "rejoindre", type: "guide", nom: "X", email: "x@exemple.invalid" });
  v("candidature sans message refusée", r.status === 400 && r.body.error === "MESSAGE" && !st.lignes.length);
  r = await envoyer({ formulaire: "prive", nom: "", email: "a@exemple.invalid" });
  v("nom obligatoire", r.status === 400 && r.body.error === "NOM");
  r = await envoyer({ formulaire: "prive", nom: "A", email: "pas-un-email" });
  v("email invalide refusé", r.status === 400 && r.body.error === "EMAIL");
  r = await envoyer({ formulaire: "prive", nom: "A", email: "a@exemple.invalid", site_web: "http://spam" });
  v("robot (champ piège rempli) : réponse normale, rien d'enregistré", r.status === 200 && !st.lignes.length && !st.appels.length);
  r = await envoyer({ formulaire: "prive", nom: "A", email: "a@exemple.invalid", duree_ms: 500 });
  const alerteRapide = st.appels.find((x) => x.chemin === "/v3/smtp/email");
  v("envoi très rapide : gardé (pas perdu) et signalé « à vérifier »", r.status === 200 && st.lignes.length === 1 && alerteRapide && /À vérifier/.test(alerteRapide.corps.subject));
  st = null;
  process.env.NOTIFY_EMAIL = "alertes@exemple.invalid";
  r = await envoyer({ formulaire: "rejoindre", type: "guide", nom: "Léa", email: "lea@exemple.invalid", message: "Je suis guide." });
  const alerteNotif = st.appels.find((x) => x.chemin === "/v3/smtp/email");
  v("candidature : alerte à NOTIFY_EMAIL, réponse vers la personne, lien vers l'onglet Validations", r.status === 200 && alerteNotif &&
    alerteNotif.corps.to[0].email === "alertes@exemple.invalid" && alerteNotif.corps.replyTo.email === "lea@exemple.invalid" && alerteNotif.corps.htmlContent.includes("https://artdive.app/#espace=valider"));
  const file = st.envois[0];
  v("l'alerte passe par la file, reliée à la candidature (notification non envoyée visible en cas d'échec)", file && file.type === "alerte_candidature" &&
    file.cible_table === "candidatures" && file.cible_id === "id-1" && file.donnees.pour_association === true);
  const ordre = st.appels.findIndex((x) => x.m === "POST" && /candidatures/.test(x.chemin)) < st.appels.findIndex((x) => x.chemin === "/v3/smtp/email");
  v("la demande est enregistrée AVANT l'envoi de l'email", ordre);
  delete process.env.NOTIFY_EMAIL;
  st = { garder: true, appels: [], lignes: [], envois: [], recentes: 3 };
  r = await envoyer({ formulaire: "prive", nom: "A", email: "a@exemple.invalid" });
  v("4e demande dans l'heure refusée", r.status === 429 && !st.lignes.length);
  st = null;
  r = await envoyer({ formulaire: "autre", nom: "A", email: "a@exemple.invalid" });
  v("formulaire inconnu refusé", r.status === 400);
  console.log("\n" + ok + " réussis, " + ko + " en échec"); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
