/* Banc d'essai des fonctions Netlify des réservations.
   Supabase = vraie base PostgreSQL locale (rôle service_role) ;
   Stripe et Brevo = faux serveurs en mémoire.
   node tests/reservations-fonctions.test.js <chemin du dépôt> <base> (NODE_PATH vers « pg ») */
const path = require("path");
const crypto = require("crypto");
const { Client } = require("pg");

const DEPOT = process.argv[2];
const DB = process.argv[3] || "h";
const db = new Client({ host: "localhost", user: "sbadmin", password: "x", database: DB });

process.env.STRIPE_SECRET_KEY = "sk_test_faux";
process.env.STRIPE_WEBHOOK_SECRET = "whsec_faux_secret";
process.env.SUPABASE_SECRET_KEY = "sb_secret_faux";
process.env.BREVO_API_KEY = "xkeysib-faux";

/* ---------- faux Stripe ---------- */
const ST = { sessions: {}, pis: {}, refunds: [], idem: {}, appels: [] };
let n = 0;
const nouvelId = (p) => p + "_test_" + (++n);
let stripeEnPanne = false;
let fraisReponse = "succeeded";   // ou "authentication_required"

function stripePost(chemin, f, cle) {
  if (cle && ST.idem[cle]) return ST.idem[cle];                 // idempotence comme Stripe
  let rep;
  if (stripeEnPanne) rep = [500, { error: { message: "panne" } }];
  else if (chemin === "checkout/sessions") {
    const id = nouvelId("cs");
    const s = { id, url: "https://checkout.stripe.test/" + id, status: "open", payment_status: "unpaid",
      created: Math.floor(Date.now() / 1000), metadata: {}, amount_total: Number(f["line_items[0][price_data][unit_amount]"]),
      params: f };
    for (const k of Object.keys(f)) { const m = k.match(/^metadata\[(.+)\]$/); if (m) s.metadata[m[1]] = f[k]; }
    ST.sessions[id] = s; rep = [200, s];
  } else if (chemin === "refunds") {
    const r = { id: nouvelId("re"), payment_intent: f.payment_intent, amount: Number(f.amount) };
    ST.refunds.push(r); rep = [200, r];
  } else if (/^payment_methods\/[^/]+\/detach$/.test(chemin)) {
    rep = [200, { id: chemin.split("/")[1], customer: null }];
  } else if (chemin === "payment_intents") {
    if (fraisReponse === "succeeded") { const pi = { id: nouvelId("pi"), status: "succeeded", amount: Number(f.amount), params: f }; ST.pis[pi.id] = pi; rep = [200, pi]; }
    else rep = [402, { error: { code: "authentication_required", message: "auth" } }];
  } else rep = [404, { error: { message: "inconnu " + chemin } }];
  ST.appels.push({ chemin, f, cle, status: rep[0] });
  if (cle) ST.idem[cle] = rep;
  return rep;
}
function payer(sessionId, pm = "pm_carte") {
  const s = ST.sessions[sessionId];
  const pi = { id: nouvelId("pi"), customer: "cus_x", payment_method: pm, status: "succeeded" };
  ST.pis[pi.id] = pi;
  Object.assign(s, { status: "complete", payment_status: "paid", payment_intent: pi.id, customer: "cus_x" });
  return s;
}

/* ---------- faux Supabase (vraie base) ---------- */
async function sql(q, args) {
  await db.query("begin"); await db.query("set local role service_role");
  try { const r = await db.query(q, args); await db.query("commit"); return r; }
  catch (e) { await db.query("rollback"); throw e; }
}
async function supabaseRepond(url, init) {
  const u = new URL(url);
  const corps = init.body ? JSON.parse(init.body) : null;
  if (init.headers.apikey !== "sb_secret_faux") return [401, { message: "mauvaise clé" }];
  let m;
  if ((m = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/))) {
    const noms = Object.keys(corps || {});
    const fn = "public." + m[1] + "(" + noms.map((k, i) => k + " => $" + (i + 1)).join(", ") + ")";
    const ensemble = ["envois_a_traiter"].includes(m[1]);
    const q = ensemble ? "select coalesce(jsonb_agg(to_jsonb(x)), '[]') as r from " + fn + " x" : "select " + fn + " as r";
    try { const r = await sql(q, noms.map((k) => corps[k])); return [200, r.rows[0].r]; }
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

const brevo = [];
global.fetch = async (url, init = {}) => {
  init.headers = init.headers || {};
  const reponse = (status, data) => ({ ok: status < 300, status, json: async () => data, text: async () => (data == null ? "" : JSON.stringify(data)) });
  if (url.startsWith("https://api.stripe.com/v1/")) {
    if (init.headers.Authorization !== "Bearer sk_test_faux") return reponse(401, { error: { message: "clé" } });
    const u = new URL(url); const chemin = u.pathname.replace("/v1/", "");
    if (init.method === "POST") { const [s, d] = stripePost(chemin, Object.fromEntries(new URLSearchParams(init.body)), init.headers["Idempotency-Key"]); return reponse(s, d); }
    let m;
    if ((m = chemin.match(/^checkout\/sessions\/([^/]+)$/))) return ST.sessions[m[1]] ? reponse(200, ST.sessions[m[1]]) : reponse(404, { error: { message: "No such" } });
    if ((m = chemin.match(/^payment_intents\/([^/]+)$/))) return ST.pis[m[1]] ? reponse(200, ST.pis[m[1]]) : reponse(404, { error: { message: "No such" } });
    return reponse(404, { error: { message: "inconnu" } });
  }
  if (url.startsWith("https://mepcwassmoespzzsdjxf.supabase.co/")) { const [s, d] = await supabaseRepond(url, init); return reponse(s, d); }
  if (url === "https://api.brevo.com/v3/smtp/email") { brevo.push(JSON.parse(init.body)); return reponse(201, { messageId: "m" }); }
  throw new Error("Appel réseau inattendu : " + url);
};

/* ---------- outils ---------- */
const F = (f) => require(path.join(DEPOT, "netlify/functions/" + f + ".js")).handler;
const reserver = F("reserver"), reservation = F("reservation"), taches = F("taches"), webhook = F("stripe-webhook");
const post = (h, body) => h({ httpMethod: "POST", body: JSON.stringify(body), headers: {} });
const lire = (r) => JSON.parse(r.body);
let nEvt = 0;
function evenement(type, objet) {
  const corps = JSON.stringify({ id: "evt_r" + (++nEvt), type, data: { object: objet } });
  const t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", process.env.STRIPE_WEBHOOK_SECRET).update(t + "." + corps).digest("hex");
  return webhook({ httpMethod: "POST", body: corps, headers: { "stripe-signature": "t=" + t + ",v1=" + sig } });
}
const ligne = async (q, a) => (await db.query(q, a)).rows[0];
const mails = (type) => brevo.filter((m) => (m.tags || []).includes(type));
let ok = 0, ko = 0;
function verifier(nom, cond, detail) {
  if (cond) { ok++; console.log("OK     " + nom); }
  else { ko++; console.log("ÉCHEC  " + nom + (detail !== undefined ? "  → " + JSON.stringify(detail).slice(0, 300) : "")); }
}

(async () => {
  await db.connect();
  // Données : un guide (avec email privé), une visite publiée, des séances.
  const g = (await db.query("insert into public.intervenants (localite_id, slug, type, nom, publie) values ('montmartre','guide-test','guide','Sylvain Test',true) returning id")).rows[0].id;
  await db.query("insert into public.intervenants_contacts (intervenant_id, email) values ($1, 'guide@exemple.invalid')", [g]);
  const x = (await db.query(`insert into public.experiences (localite_id, slug, type, titre, intervenant_id, prix_centimes, prereservation_centimes,
      capacite_max, participants_min, telephone_obligatoire, publie, duree_minutes)
      values ('montmartre','circuit-test','visite_guidee','{"fr":"Circuit des Peintres","en":"Painters walk"}',$1,5000,500,10,2,true,true,120) returning id`, [g])).rows[0].id;
  const seance = async (h, min = 2, cap = 10) => (await db.query(
    "insert into public.seances (experience_id, debut, point_rdv, point_rdv_precis, message_inscrits, statut, participants_min, capacite_max) values ($1, now() + make_interval(hours => $2), 'Square', 'Devant le kiosque', 'Je porte un chapeau <gris>', 'publiee', $3, $4) returning id",
    [x, h, min, cap])).rows[0].id;
  const sLoin = await seance(120), sProche = await seance(20, 1), sMin = await seance(40, 4), sPetite = await seance(100, 1, 1);
  const base = { personnes: 2, nom: "Camille <b>Durand</b>", email: "Camille@Exemple.invalid", telephone: "0612345678", langue: "fr", consentements: { cgv: true, non_remboursable: true, sans_retractation: true, prelevement: true } };

  // ---- reserver ----
  let r = await post(reserver, Object.assign({}, base, { seance_id: "pas-un-uuid" }));
  verifier("reserver : paramètres invalides refusés", r.statusCode === 400);
  r = await post(reserver, Object.assign({}, base, { seance_id: sLoin, consentements: { cgv: true, non_remboursable: true, sans_retractation: true } }));
  verifier("reserver : sans accord pour les frais, refus clair (cases)", r.statusCode === 400 && lire(r).code === "ACCORD_FRAIS_REQUIS", lire(r));
  r = await post(reserver, Object.assign({}, base, { seance_id: sLoin, consentements: { cgv: true, prelevement: true, sans_retractation: true } }));
  verifier("reserver : sans la case « non remboursable », refus", r.statusCode === 400 && lire(r).code === "CONSENTEMENTS_MANQUANTS", lire(r));
  r = await post(reserver, Object.assign({}, base, { seance_id: sLoin, consentements: { cgv: "oui", non_remboursable: 1, sans_retractation: true, prelevement: true } }));
  verifier("reserver : une case qui n'est pas vraiment cochée (true) ne compte pas", r.statusCode === 400 && lire(r).code === "CGV_NON_ACCEPTEES", lire(r));
  r = await post(reserver, Object.assign({}, base, { seance_id: sLoin, consentements: { cgv: true, non_remboursable: true, sans_retractation: true } }));
  verifier("reserver : sans accord pour les frais, refus clair", r.statusCode === 400 && lire(r).code === "ACCORD_FRAIS_REQUIS", lire(r));
  r = await post(reserver, Object.assign({}, base, { seance_id: sLoin, telephone: "" }));
  verifier("reserver : téléphone obligatoire pour une visite", r.statusCode === 400 && lire(r).code === "TELEPHONE_REQUIS");
  r = await post(reserver, Object.assign({}, base, { seance_id: sLoin }));
  const sess1 = Object.values(ST.sessions).pop();
  verifier("reserver : adresse de paiement Stripe renvoyée", r.statusCode === 200 && lire(r).url === sess1.url, lire(r));
  verifier("reserver : 10 € à payer (2 × 5 €), prix venu de la base", sess1.params["line_items[0][price_data][unit_amount]"] === "1000");
  verifier("reserver : carte gardée pour les frais, avec la mention", sess1.params["payment_intent_data[setup_future_usage]"] === "off_session" && /24 h/.test(sess1.params["custom_text[submit][message]"]));
  verifier("reserver : expiration 30 min, retour vers montmartre.app", Number(sess1.params.expires_at) - Date.now() / 1000 > 1700 && sess1.params.success_url === "https://montmartre.app/?reservation={CHECKOUT_SESSION_ID}");
  const resa1 = sess1.metadata.reservation_id;
  verifier("reserver : places bloquées en attente du paiement", (await ligne("select statut from public.reservations where id = $1", [resa1])).statut === "en_attente");
  r = await post(reserver, Object.assign({}, base, { seance_id: sLoin, personnes: 9 }));
  verifier("reserver : plus assez de places → complet", r.statusCode === 409 && lire(r).code === "COMPLET", lire(r));
  stripeEnPanne = true;
  r = await post(reserver, Object.assign({}, base, { seance_id: sLoin, personnes: 1, email: "panne@exemple.invalid" }));
  stripeEnPanne = false;
  verifier("reserver : Stripe en panne → places libérées aussitôt", r.statusCode === 502 && (await ligne("select statut from public.reservations where email = 'panne@exemple.invalid'")).statut === "expiree");

  // ---- paiement → webhook ----
  payer(sess1.id);
  r = await evenement("checkout.session.completed", { id: sess1.id, metadata: sess1.metadata });
  const a = await ligne("select * from public.reservations where id = $1", [resa1]);
  verifier("webhook : réservation confirmée, carte gardée", r.statusCode === 200 && a.statut === "confirmee" && a.stripe_payment_method === "pm_carte", a && a.statut);
  const conf = mails("confirmation")[0];
  verifier("email de confirmation envoyé tout de suite, au client", conf && conf.to[0].email === "camille@exemple.invalid");
  verifier("confirmation : récapitulatif, reste sur place, monnaie, frais", conf && /90\s€/.test(conf.textContent) && /monnaie/.test(conf.textContent) && /10\s€ de frais/.test(conf.textContent) && /Devant le kiosque/.test(conf.textContent), conf && conf.textContent);
  verifier("confirmation : textes venus de la base échappés (pas de HTML injecté)", conf && !conf.htmlContent.includes("<b>Durand") && conf.htmlContent.includes("&lt;gris&gt;"));
  const m1 = conf && conf.htmlContent.match(/https:\/\/montmartre\.app\/#reservation=([0-9a-f]{64})/);
  verifier("confirmation : bouton « Je ne peux plus venir » avec lien personnel", !!m1);
  verifier("confirmation : fichier calendrier joint", conf && conf.attachment && /BEGIN:VEVENT/.test(Buffer.from(conf.attachment[0].content, "base64").toString()));
  verifier("confirmation : rappel « pas de droit de rétractation » et lien vers les CGV datées", conf && /L221-28/.test(conf.textContent) && conf.htmlContent.includes("https://montmartre.app/cgv.html") && /2026-11-18/.test(conf.htmlContent));
  verifier("cases cochées et version des CGV gardées", (await ligne("select consentements ?& array['cgv','non_remboursable','sans_retractation','prelevement'] as ok, cgv_version from public.reservations where id = $1", [resa1])).ok === true);
  verifier("pas de long tiret dans les emails", !brevo.some((m) => /—/.test(m.subject + m.htmlContent)));
  verifier("alertes : association et guide prévenus", mails("alerte_inscription").map((m) => m.to[0].email).sort().join() === "guide@exemple.invalid,mouvementmontmartre@gmail.com");
  verifier("le lien personnel n'est plus stocké après l'envoi", !(await ligne("select 1 from public.envois where statut = 'envoye' and donnees ? 'jeton'")));
  const nb = brevo.length;
  r = await evenement("checkout.session.completed", { id: sess1.id, metadata: sess1.metadata });
  verifier("webhook rejoué : aucun email de plus", r.statusCode === 200 && brevo.length === nb);

  // Réservations faites tôt : Mia (séance sous le minimum), Rose (garde la séance proche au-dessus du minimum).
  for (const [sid, mail] of [[sMin, "mia@exemple.invalid"], [sProche, "rose@exemple.invalid"]]) {
    await post(reserver, Object.assign({}, base, { seance_id: sid, personnes: 1, email: mail }));
    const se = Object.values(ST.sessions).pop(); payer(se.id);
    await evenement("checkout.session.completed", { id: se.id, metadata: se.metadata });
  }
  const sess4 = { id: Object.values(ST.sessions).find((se) => se.params.customer_email === "mia@exemple.invalid").id };

  // ---- retour sur l'app ----
  r = await post(reservation, { action: "session", session_id: sess1.id });
  const ret = lire(r);
  verifier("retour du paiement : lien et récapitulatif sans email ni téléphone", r.statusCode === 200 && /^[0-9a-f]{64}$/.test(ret.jeton) && ret.reservation.statut === "confirmee" && !("email" in ret.reservation) && !("telephone" in ret.reservation), ret);
  r = await post(reservation, { action: "voir", jeton: m1 && m1[1] });
  verifier("le lien de l'email ouvre la réservation", r.statusCode === 200 && lire(r).reservation.peut_annuler === true);
  r = await post(reservation, { action: "voir", jeton: "0".repeat(64) });
  verifier("lien inconnu : introuvable", r.statusCode === 404);

  // ---- annulation plus de 24 h avant ----
  r = await post(reservation, { action: "annuler", jeton: m1[1] });
  verifier("annulation 5 jours avant : sans frais", r.statusCode === 200 && lire(r).annulation.frais_centimes === 0, lire(r));
  verifier("annulation : email au client et alertes au guide et à l'association", mails("annulation_client").length === 1 && mails("alerte_annulation").length === 2);
  verifier("annulation : aucun remboursement (5 € gardés), aucun prélèvement", ST.refunds.length === 0 && !ST.appels.some((c) => c.chemin === "payment_intents"));
  r = await post(reservation, { action: "annuler", jeton: m1[1] });
  const det = ST.appels.find((c) => c.chemin === "payment_methods/pm_carte/detach");
  verifier("annulation sans frais : carte retirée de Stripe aussitôt (CGV 10.4)", det && /^detach-/.test(det.cle) && (await ligne("select stripe_payment_method, carte_retiree_le from public.reservations where id = $1", [resa1])).carte_retiree_le !== null, det);
  verifier("annuler deux fois : sans effet", r.statusCode === 200 && lire(r).annulation.deja_annulee === true);

  // ---- annulation tardive : frais prélevés ----
  await post(reserver, Object.assign({}, base, { seance_id: sProche, email: "tard@exemple.invalid" }));
  const sess2 = Object.values(ST.sessions).pop(); payer(sess2.id, "pm_tard");
  await evenement("checkout.session.completed", { id: sess2.id, metadata: sess2.metadata });
  const m2 = mails("confirmation").pop().htmlContent.match(/#reservation=([0-9a-f]{64})/);
  r = await post(reservation, { action: "annuler", jeton: m2[1] });
  verifier("annulation 20 h avant : 20 € de frais (2 × 10 €)", lire(r).annulation.frais_centimes === 2000, lire(r));
  const pf = ST.appels.find((c) => c.chemin === "payment_intents");
  verifier("frais prélevés sur la carte gardée, hors session, avec clé anti-doublon", pf && pf.f.payment_method === "pm_tard" && pf.f.off_session === "true" && pf.f.amount === "2000" && /^frais-/.test(pf.cle), pf);
  verifier("frais : reçu envoyé au client", mails("frais_preleves").length === 1 && /20\s€/.test(mails("frais_preleves")[0].textContent));
  await post(taches, {});
  verifier("frais prélevés : carte retirée ensuite", ST.appels.some((c) => c.chemin === "payment_methods/pm_tard/detach"));
  verifier("tâche relancée : pas de deuxième prélèvement", ST.appels.filter((c) => c.chemin === "payment_intents").length === 1);

  // ---- la banque demande une validation : lien de paiement ----
  await post(reserver, Object.assign({}, base, { seance_id: sProche, personnes: 1, email: "auth@exemple.invalid" }));
  const sess3 = Object.values(ST.sessions).pop(); payer(sess3.id, "pm_auth");
  await evenement("checkout.session.completed", { id: sess3.id, metadata: sess3.metadata });
  const m3 = mails("confirmation").pop().htmlContent.match(/#reservation=([0-9a-f]{64})/);
  fraisReponse = "authentication_required";
  await post(reservation, { action: "annuler", jeton: m3[1] });
  fraisReponse = "succeeded";
  const lienFrais = mails("frais_a_payer")[0];
  const sessFrais = Object.values(ST.sessions).pop();
  verifier("validation bancaire demandée : email avec lien de paiement de 10 €", lienFrais && lienFrais.htmlContent.includes(sessFrais.url) && sessFrais.amount_total === 1000, lienFrais && lienFrais.textContent);
  await evenement("checkout.session.completed", { id: sessFrais.id, metadata: sessFrais.metadata, payment_status: "paid", payment_intent: "pi_frais_lien" });
  verifier("frais réglés par le lien : notés comme prélevés", (await ligne("select frais_statut from public.reservations where email = 'auth@exemple.invalid'")).frais_statut === "preleve");

  // ---- minimum non atteint : séance annulée, remboursement ----
  const bilan = lire(await post(taches, {}));
  const remb = ST.refunds.find((x) => x.payment_intent === ST.sessions[sess4.id].payment_intent);
  verifier("tâche : séance sous le minimum annulée, inscrite remboursée de 5 €", remb && remb.amount === 500 && (await ligne("select statut from public.seances where id = $1", [sMin])).statut === "annulee", bilan);
  verifier("remboursement : clé anti-doublon remb-<id>", ST.appels.some((c) => c.chemin === "refunds" && /^remb-/.test(c.cle)));
  verifier("séance annulée : email au client, alerte guide et association", mails("seance_annulee").some((m) => m.to[0].email === "mia@exemple.invalid") && mails("alerte_seance_annulee").length === 2);
  verifier("réservation marquée remboursée", (await ligne("select statut from public.reservations where email = 'mia@exemple.invalid'")).statut === "remboursee");
  const nbRemb = ST.refunds.length;
  await post(taches, {});
  verifier("tâche relancée : pas de deuxième remboursement", ST.refunds.length === nbRemb);

  // ---- paiement abandonné, paiement tardif ----
  await post(reserver, Object.assign({}, base, { seance_id: sPetite, personnes: 1, email: "lent@exemple.invalid" }));
  const sess5 = Object.values(ST.sessions).pop();
  await db.query("update public.reservations set bloque_jusqua = now() - interval '1 minute' where email = 'lent@exemple.invalid'");
  await post(reserver, Object.assign({}, base, { seance_id: sPetite, personnes: 1, email: "rapide@exemple.invalid" }));
  const sess6 = Object.values(ST.sessions).pop(); payer(sess6.id);
  await evenement("checkout.session.completed", { id: sess6.id, metadata: sess6.metadata });
  payer(sess5.id);
  await evenement("checkout.session.completed", { id: sess5.id, metadata: sess5.metadata });
  const lent = await ligne("select statut, annulee_par from public.reservations where email = 'lent@exemple.invalid'");
  verifier("paiement après le blocage, dernière place prise : annulé et remboursé", lent.annulee_par === "paiement_tardif" && ST.refunds.some((x) => x.payment_intent === ST.sessions[sess5.id].payment_intent), lent);
  verifier("paiement tardif : email d'explication", mails("paiement_tardif").some((m) => m.to[0].email === "lent@exemple.invalid"));
  await post(reserver, Object.assign({}, base, { seance_id: sLoin, personnes: 1, email: "abandon@exemple.invalid" }));
  const sess7 = Object.values(ST.sessions).pop();
  await evenement("checkout.session.expired", { id: sess7.id, metadata: sess7.metadata });
  verifier("paiement abandonné : place libérée", (await ligne("select statut from public.reservations where email = 'abandon@exemple.invalid'")).statut === "expiree");

  // ---- anglais ----
  await post(reserver, Object.assign({}, base, { seance_id: sLoin, personnes: 1, email: "en@exemple.invalid", langue: "en" }));
  const sess8 = Object.values(ST.sessions).pop(); payer(sess8.id);
  await evenement("checkout.session.completed", { id: sess8.id, metadata: sess8.metadata });
  const en = mails("confirmation").pop();
  verifier("email en anglais pour une réservation en anglais", /Your spot is booked: Painters walk/.test(en.subject) && /bring cash/.test(en.textContent), en.subject);

  console.log("\n" + ok + " réussis, " + ko + " en échec");
  await db.end();
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
