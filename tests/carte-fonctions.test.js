/* Banc d'essai des fonctions Netlify des cartes de membre.
   Supabase = vraie base PostgreSQL locale (rôle service_role) ;
   Stripe et Brevo = faux serveurs en mémoire. */
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const DEPOT = process.argv[2];
const DB = process.argv[3] || "h";
const db = new Client({ host: "localhost", user: "sbadmin", password: "x", database: DB });

process.env.STRIPE_SECRET_KEY = "sk_test_faux";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_faux_secret";
process.env.SUPABASE_SECRET_KEY = "sb_secret_faux";
delete process.env.BREVO_API_KEY;

/* ---------- faux Stripe ---------- */
const now = Math.floor(Date.now() / 1000);
const J = 24 * 3600;
const S = { sessions: {}, subscriptions: {}, customers: {}, lignes: {} };
const prix = (prod) => ({ id: "price_" + prod, product: prod });
S.customers.cus_1 = { id: "cus_1", email: "Camille@Exemple.invalid", name: "Nom Stripe" };
S.customers.cus_2 = { id: "cus_2", email: "bea@exemple.invalid", name: "Bea Bienfaitrice" };
S.customers.cus_3 = { id: "cus_3", email: "retard@exemple.invalid", name: "Rita Retard" };
S.subscriptions.sub_1 = { id: "sub_1", status: "active", customer: "cus_1", start_date: now - 60,
  current_period_start: now - 60, current_period_end: now + 365 * J,
  items: { data: [{ price: prix("prod_QtJ7IT1fz5OdTm"), quantity: 2 }] } };
// API 2025 : la période est sur les lignes
S.subscriptions.sub_2 = { id: "sub_2", status: "active", customer: "cus_2", start_date: now - 10,
  items: { data: [{ price: prix("prod_Oxr9yYcyaqlt6J"), current_period_start: now - 10, current_period_end: now + 30 * J }] } };
S.subscriptions.sub_3 = { id: "sub_3", status: "past_due", customer: "cus_3", start_date: now - 400 * J,
  current_period_start: now - 5 * J, current_period_end: now + 360 * J,
  items: { data: [{ price: prix("prod_QtJ7IT1fz5OdTm") }] } };
S.subscriptions.sub_autre = { id: "sub_autre", status: "active", customer: "cus_1", start_date: now,
  current_period_start: now, current_period_end: now + 30 * J, items: { data: [{ price: prix("prod_AUTRE") }] } };
S.sessions.cs_test_abo = { id: "cs_test_abo", status: "complete", payment_status: "paid", mode: "subscription",
  created: now - 30, subscription: "sub_1", customer: "cus_1",
  customer_details: { email: "camille@exemple.invalid", name: "Nom Carte" },
  custom_fields: [{ key: "prenomnom", text: { value: "Camille Durand" } }], payment_link: "plink_1UcTjACtjp0QuQA6Eu4JQKAL" };
S.lignes.cs_test_abo = [prix("prod_QtJ7IT1fz5OdTm")];
S.sessions.cs_test_vieille = Object.assign({}, S.sessions.cs_test_abo, { id: "cs_test_vieille", created: now - 2 * J });
S.lignes.cs_test_vieille = S.lignes.cs_test_abo;
S.sessions.cs_test_ponct = { id: "cs_test_ponct", status: "complete", payment_status: "paid", mode: "payment",
  created: now - 100 * J, payment_intent: "pi_ponct", customer: null, payment_link: "plink_1SRbm0Ctjp0QuQA6HA5b0bmd",
  customer_details: { email: "paul@exemple.invalid", name: "Paul Ponctuel" }, custom_fields: [{ key: "prnomnom", text: { value: "Paul P." } }] };
S.lignes.cs_test_ponct = [prix("prod_TOOZOTIr3wJsYq")];
S.sessions.cs_test_visite = { id: "cs_test_visite", status: "complete", payment_status: "paid", mode: "payment",
  created: now - 30, payment_intent: "pi_visite", customer_details: { email: "touriste@exemple.invalid" }, custom_fields: [] };
S.lignes.cs_test_visite = [prix("prod_VISITE")];

const brevo = [];
let appelsStripe = 0;

function stripeRepond(url) {
  appelsStripe++;
  const u = new URL(url);
  const p = u.pathname.replace("/v1/", "");
  const expandCustomer = (sub) => Object.assign({}, sub, { customer: S.customers[sub.customer] });
  let m;
  if ((m = p.match(/^checkout\/sessions\/([^/]+)\/line_items$/))) return { data: (S.lignes[m[1]] || []).map((pr) => ({ price: pr })) };
  if ((m = p.match(/^checkout\/sessions\/([^/]+)$/))) {
    const s = S.sessions[m[1]]; if (!s) return null;
    return Object.assign({}, s, { line_items: { data: (S.lignes[s.id] || []).map((pr) => ({ price: pr })) } });
  }
  if (p === "checkout/sessions") {
    const lien = u.searchParams.get("payment_link"), gte = Number(u.searchParams.get("created[gte]") || 0);
    return { data: Object.values(S.sessions).filter((s) => s.payment_link === lien && s.created >= gte), has_more: false };
  }
  if ((m = p.match(/^subscriptions\/([^/]+)$/))) { const s = S.subscriptions[m[1]]; return s ? expandCustomer(s) : null; }
  if (p === "subscriptions") return { data: Object.values(S.subscriptions).map(expandCustomer), has_more: false };
  if ((m = p.match(/^customers\/([^/]+)$/))) return S.customers[m[1]] || null;
  return null;
}

/* ---------- faux Supabase (vraie base, rôle service_role) ---------- */
async function sql(q, args) {
  await db.query("begin"); await db.query("set local role service_role");
  try { const r = await db.query(q, args); await db.query("commit"); return r; }
  catch (e) { await db.query("rollback"); throw e; }
}
async function supabaseRepond(url, init) {
  const u = new URL(url);
  const corps = init.body ? JSON.parse(init.body) : null;
  if (init.headers.apikey !== "sb_secret_faux" || init.headers.Authorization) return [401, { message: "mauvaise clé" }];
  let m;
  if ((m = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/))) {
    const noms = Object.keys(corps || {});
    const q = "select public." + m[1] + "(" + noms.map((n, i) => n + " => $" + (i + 1)).join(", ") + ") as r";
    try { const r = await sql(q, noms.map((n) => corps[n])); return [200, r.rows[0].r]; }
    catch (e) { return [400, { message: e.message }]; }
  }
  if (u.pathname === "/rest/v1/webhook_evenements") {
    const id = (u.searchParams.get("stripe_event_id") || "").replace(/^eq\./, "");
    if (init.method === "POST") { await sql("insert into public.webhook_evenements (stripe_event_id, type) values ($1, $2) on conflict do nothing", [corps.stripe_event_id, corps.type]); return [201, null]; }
    if (init.method === "GET") { const r = await sql("select traite_le from public.webhook_evenements where stripe_event_id = $1", [id]); return [200, r.rows]; }
    if (init.method === "PATCH") { await sql("update public.webhook_evenements set traite_le = $2 where stripe_event_id = $1", [id, corps.traite_le]); return [204, null]; }
  }
  return [404, { message: "inconnu " + u.pathname }];
}

global.fetch = async (url, init = {}) => {
  init.headers = init.headers || {};
  const reponse = (status, data) => ({ ok: status < 300, status,
    json: async () => data, text: async () => (data == null ? "" : JSON.stringify(data)) });
  if (url.startsWith("https://api.stripe.com/")) {
    if (init.headers.Authorization !== "Bearer sk_test_faux") return reponse(401, { error: { message: "clé" } });
    const d = stripeRepond(url); return d ? reponse(200, d) : reponse(404, { error: { message: "No such object" } });
  }
  if (url.startsWith("https://mepcwassmoespzzsdjxf.supabase.co/")) { const [s, d] = await supabaseRepond(url, init); return reponse(s, d); }
  if (url === "https://api.brevo.com/v3/smtp/email") { brevo.push(JSON.parse(init.body)); return reponse(201, { messageId: "m" }); }
  throw new Error("Appel réseau inattendu : " + url);
};

/* ---------- outils ---------- */
const webhook = require(path.join(DEPOT, "netlify/functions/stripe-webhook.js")).handler;
const carte = require(path.join(DEPOT, "netlify/functions/carte.js")).handler;
const importer = require(path.join(DEPOT, "netlify/functions/import-adhesions.js")).handler;

function signer(corps, secret = process.env.STRIPE_WEBHOOK_SECRET, t = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac("sha256", secret).update(t + "." + corps).digest("hex");
  return "t=" + t + ",v1=" + sig;
}
let nEvt = 0;
async function evenement(type, objet, opts = {}) {
  const corps = JSON.stringify({ id: opts.id || "evt_test" + (++nEvt), type, data: { object: objet } });
  return webhook({ httpMethod: "POST", body: corps, isBase64Encoded: false,
    headers: { "stripe-signature": opts.signature || signer(corps) } });
}
const post = (h, body) => h({ httpMethod: "POST", body: JSON.stringify(body), headers: {} });
const lire = (r) => JSON.parse(r.body);
async function ligne(q, a) { const r = await db.query(q, a); return r.rows[0]; }

let ok = 0, ko = 0;
function verifier(nom, cond, detail) {
  if (cond) { ok++; console.log("OK     " + nom); }
  else { ko++; console.log("ÉCHEC  " + nom + (detail !== undefined ? "  → " + JSON.stringify(detail) : "")); }
}

(async () => {
  await db.connect();

  // Webhook : signature
  let r = await evenement("checkout.session.completed", { id: "cs_test_abo" }, { signature: "t=1,v1=00" });
  verifier("webhook : signature fausse refusée", r.statusCode === 400, r);
  r = await evenement("checkout.session.completed", { id: "cs_test_abo" }, { signature: signer("{}", "whsec_autre") });
  verifier("webhook : signature d'un autre secret refusée", r.statusCode === 400, r);
  const vieux = JSON.stringify({ id: "evt_vieux", type: "x", data: { object: {} } });
  r = await webhook({ httpMethod: "POST", body: vieux, headers: { "stripe-signature": signer(vieux, undefined, Math.floor(Date.now() / 1000) - 3600) } });
  verifier("webhook : signature d'il y a une heure refusée (rejeu)", r.statusCode === 400, r);

  // Adhésion annuelle
  r = await evenement("checkout.session.completed", { id: "cs_test_abo" }, { id: "evt_abo" });
  verifier("webhook : adhésion annuelle acceptée", r.statusCode === 200, r);
  let a = await ligne("select * from public.adhesions where stripe_subscription = 'sub_1'");
  verifier("adhésion : email en minuscules, nom du champ « Prénom Nom »", a && a.email === "camille@exemple.invalid" && a.nom === "Camille Durand", a);
  verifier("adhésion : valable jusqu'à la fin de la période payée", a && Math.abs(a.valide_jusqua / 1000 - (now + 365 * J)) < 5, a && a.valide_jusqua);
  r = await evenement("checkout.session.completed", { id: "cs_test_abo" }, { id: "evt_abo" });
  verifier("webhook : même évènement reçu deux fois, traité une fois", r.statusCode === 200 && lire(r).deja_traite === true, r);
  verifier("adhésion : pas de doublon", (await ligne("select count(*)::int n from public.adhesions where email = 'camille@exemple.invalid'")).n === 1);

  // Renouvellement
  S.subscriptions.sub_1.current_period_end = now + 730 * J;
  r = await evenement("invoice.paid", { id: "in_1", subscription: "sub_1" });
  a = await ligne("select * from public.adhesions where stripe_subscription = 'sub_1'");
  verifier("renouvellement : la carte est prolongée", r.statusCode === 200 && Math.abs(a.valide_jusqua / 1000 - (now + 730 * J)) < 5, a && a.valide_jusqua);
  r = await evenement("invoice.paid", { id: "in_2", parent: { subscription_details: { subscription: "sub_1" } } });
  verifier("renouvellement (format de facture 2025) accepté", r.statusCode === 200, r);

  // Paiement d'autre chose : ignoré
  r = await evenement("checkout.session.completed", { id: "cs_test_visite" });
  verifier("webhook : un paiement de visite ne crée pas d'adhésion", r.statusCode === 200 && !(await ligne("select 1 from public.adhesions where email = 'touriste@exemple.invalid'")));
  r = await evenement("customer.subscription.updated", S.subscriptions.sub_autre);
  verifier("webhook : un autre abonnement ne crée pas d'adhésion", r.statusCode === 200 && !(await ligne("select 1 from public.adhesions where stripe_subscription = 'sub_autre'")));

  // Bienfaiteur mensuel (période sur les lignes)
  r = await evenement("customer.subscription.updated", S.subscriptions.sub_2);
  a = await ligne("select * from public.adhesions where stripe_subscription = 'sub_2'");
  verifier("bienfaiteur : enregistré, formule bienfaiteur, valable un mois", r.statusCode === 200 && a && a.formule === "bienfaiteur" && Math.abs(a.valide_jusqua / 1000 - (now + 30 * J)) < 5, a);

  // Impayé
  r = await evenement("customer.subscription.updated", S.subscriptions.sub_3);
  a = await ligne("select * from public.adhesions where stripe_subscription = 'sub_3'");
  verifier("impayé : la carte s'arrête au début de la période non payée", a && Math.abs(a.valide_jusqua / 1000 - (now - 5 * J)) < 5, a);

  // Arrêt
  S.subscriptions.sub_1.status = "canceled";
  r = await evenement("customer.subscription.deleted", S.subscriptions.sub_1);
  a = await ligne("select * from public.adhesions where stripe_subscription = 'sub_1'");
  verifier("arrêt : statut arrêté, carte valable jusqu'à la date payée", a.statut === "arretee" && a.valide_jusqua / 1000 > now + 700 * J, a);
  verifier("renouvellements : le nom saisi à l'adhésion est gardé", a.nom === "Camille Durand", a.nom);
  S.subscriptions.sub_1.status = "active";
  await evenement("customer.subscription.updated", S.subscriptions.sub_1);

  // Ponctuel + remboursement
  r = await evenement("checkout.session.completed", { id: "cs_test_ponct" });
  a = await ligne("select * from public.adhesions where stripe_payment_intent = 'pi_ponct'");
  verifier("ponctuel : valable un an à partir du paiement", a && Math.abs(a.valide_jusqua / 1000 - (now - 100 * J + 365 * J)) < 5 && a.nom === "Paul P.", a);
  r = await evenement("charge.refunded", { id: "ch_1", refunded: true, payment_intent: "pi_ponct" });
  a = await ligne("select statut from public.adhesions where stripe_payment_intent = 'pi_ponct'");
  verifier("remboursement : adhésion marquée remboursée", a.statut === "remboursee", a);

  // Carte : retour de paiement
  r = await post(carte, { action: "session", session_id: "cs_test_abo" });
  const d = lire(r);
  verifier("carte : retour de paiement → jeton et carte", r.statusCode === 200 && /^[A-Za-z0-9_-]{43}$/.test(d.jeton) && d.carte.nom === "Camille Durand" && d.carte.valide === true, d);
  verifier("carte : le jeton n'est pas stocké en clair", !(await ligne("select 1 from public.cartes_liens where jeton_hash = $1", [d.jeton])));
  r = await post(carte, { action: "session", session_id: "cs_test_vieille" });
  verifier("carte : retour de paiement de plus de 24 h refusé", r.statusCode === 400, lire(r));
  r = await post(carte, { action: "session", session_id: "cs_test_visite" });
  verifier("carte : un paiement de visite ne donne pas de carte", r.statusCode === 400, lire(r));
  r = await post(carte, { action: "session", session_id: "../../customers" });
  verifier("carte : identifiant de session bizarre refusé", r.statusCode === 400);

  // Carte : voir
  r = await post(carte, { action: "voir", jeton: d.jeton });
  verifier("carte : voir avec le bon jeton", r.statusCode === 200 && lire(r).carte.nom === "Camille Durand", lire(r));
  r = await post(carte, { action: "voir", jeton: crypto.randomBytes(32).toString("base64url") });
  verifier("carte : jeton inconnu → introuvable", r.statusCode === 404);
  r = await post(carte, { action: "voir", jeton: "x' or 1=1 --" });
  verifier("carte : jeton mal formé refusé", r.statusCode === 400);
  r = await carte({ httpMethod: "GET", queryStringParameters: { action: "voir" }, headers: {} });
  verifier("carte : GET refusé (rien en cache)", r.statusCode === 405);

  // Carte : lien par email
  r = await post(carte, { action: "lien", email: "camille@exemple.invalid" });
  verifier("lien : sans clé Brevo → indisponible, sans rien révéler", r.statusCode === 503);
  process.env.BREVO_API_KEY = "xkeysib-faux";
  r = await post(carte, { action: "lien", email: " Camille@Exemple.invalid ", langue: "en" });
  const mail = brevo[brevo.length - 1];
  verifier("lien : adhérente → email envoyé, en anglais", r.statusCode === 200 && brevo.length === 1 && mail.to[0].email === "camille@exemple.invalid" && /member card/.test(mail.subject), mail && mail.subject);
  const m = (mail.textContent || "").match(/https:\/\/artdive\.app\/#carte=([A-Za-z0-9_-]{43})/);
  verifier("lien : pointe vers artdive.app, jeton après #", !!m, mail.textContent);
  r = await post(carte, { action: "voir", jeton: m && m[1] });
  verifier("lien : le jeton reçu par email ouvre la carte", r.statusCode === 200 && lire(r).carte.valide === true);
  const avant = brevo.length;
  r = await post(carte, { action: "lien", email: "inconnu@exemple.invalid" });
  verifier("lien : non adhérent → même réponse, aucun email", r.statusCode === 200 && lire(r).ok === true && brevo.length === avant);
  r = await post(carte, { action: "lien", email: "paul@exemple.invalid" });
  verifier("lien : adhésion remboursée → aucun email", r.statusCode === 200 && brevo.length === avant);
  await post(carte, { action: "lien", email: "camille@exemple.invalid" });
  await post(carte, { action: "lien", email: "camille@exemple.invalid" });
  const n3 = brevo.length;
  r = await post(carte, { action: "lien", email: "camille@exemple.invalid" });
  verifier("lien : au-delà de 3 par heure, plus d'email, même réponse", r.statusCode === 200 && brevo.length === n3, brevo.length);
  r = await post(carte, { action: "lien", email: "pas-un-email" });
  verifier("lien : email invalide refusé", r.statusCode === 400);

  // Import
  r = await importer({ httpMethod: "GET", queryStringParameters: {}, headers: {} });
  verifier("import : sans code refusé", r.statusCode === 400);
  r = await importer({ httpMethod: "GET", queryStringParameters: { code: "a".repeat(64) }, headers: {} });
  verifier("import : code inconnu refusé", r.statusCode === 403);
  const code = (await db.query("select public.code_import_creer() as c")).rows[0].c;
  await db.query("delete from public.adhesions");
  r = await importer({ httpMethod: "GET", queryStringParameters: { code }, headers: {} });
  const tot = lire(r);
  verifier("import : abonnements et ponctuels repris (totaux seulement)", r.statusCode === 200 && tot.abonnements === 3 && tot.ponctuels === 1 && tot.erreurs === 0 && !JSON.stringify(tot).includes("@"), tot);
  verifier("import : 4 adhésions en base", (await ligne("select count(*)::int n from public.adhesions")).n === 4);
  r = await importer({ httpMethod: "GET", queryStringParameters: { code }, headers: {} });
  verifier("import : le même code ne sert pas deux fois", r.statusCode === 403);

  console.log("\n" + ok + " réussis, " + ko + " en échec");
  await db.end();
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
