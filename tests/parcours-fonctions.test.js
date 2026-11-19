/* Parcours autoguidés côté serveur : achat, paiement, webhook, lien par email, circuit, étapes sur place ou par code.
   Supabase = vraie base PostgreSQL locale (rôle service_role) ; Stripe et Brevo = faux.
   NODE_PATH=<dossier avec « pg »> node tests/parcours-fonctions.test.js <dépôt> <base> */
const path = require("path"), crypto = require("crypto");
const { Client } = require("pg");
const DEPOT = process.argv[2], DB = process.argv[3] || "neuf";
const db = new Client({ host: "localhost", user: "sbadmin", password: "x", database: DB });
Object.assign(process.env, { STRIPE_SECRET_KEY: "sk_test_faux", STRIPE_WEBHOOK_SECRET: "whsec_faux", SUPABASE_SECRET_KEY: "sb_secret_faux", BREVO_API_KEY: "xkeysib-faux" });

const ST = { sessions: {}, idem: {} };
let n = 0;
async function sql(q, a) { await db.query("begin"); await db.query("set local role service_role");
  try { const r = await db.query(q, a); await db.query("commit"); return r; } catch (e) { await db.query("rollback"); throw e; } }
const ident = (x) => { if (!/^[a-z_]+$/.test(x)) throw new Error("nom " + x); return '"' + x + '"'; };
/** Mini PostgREST : select, filtres eq/in/gt, order, POST rpc, PATCH. */
async function supabase(url, init) {
  const u = new URL(url), corps = init.body ? JSON.parse(init.body) : null;
  if (init.headers.apikey !== "sb_secret_faux") return [401, { message: "clé" }];
  let m;
  if ((m = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/))) {
    const noms = Object.keys(corps || {});
    try { const r = await sql("select public." + m[1] + "(" + noms.map((k, i) => k + " => $" + (i + 1)).join(", ") + ") as r", noms.map((k) => corps[k])); return [200, r.rows[0].r]; }
    catch (e) { return [400, { message: e.message }]; }
  }
  const t = ident(u.pathname.replace("/rest/v1/", "")), w = [], a = [];
  for (const [k, v] of u.searchParams) {
    if (["select", "order", "limit"].includes(k)) continue;
    const [op, ...reste] = v.split("."), val = reste.join(".");
    if (op === "eq") { a.push(val); w.push(ident(k) + "::text = $" + a.length); }
    else if (op === "gt") { a.push(val); w.push(ident(k) + " > $" + a.length); }
    else if (op === "in") { a.push(val.slice(1, -1).split(",")); w.push(ident(k) + "::text = any($" + a.length + ")"); }
  }
  const ou = w.length ? " where " + w.join(" and ") : "";
  try {
    if (init.method === "PATCH") {
      const ks = Object.keys(corps); const b = a.length;
      await sql("update public." + t + " set " + ks.map((k, i) => ident(k) + " = $" + (b + i + 1)).join(", ") + ou, a.concat(ks.map((k) => typeof corps[k] === "object" && corps[k] !== null ? JSON.stringify(corps[k]) : corps[k])));
      return [204, null];
    }
    const cols = (u.searchParams.get("select") || "*").split(",").map((c) => c === "*" ? "*" : ident(c)).join(", ");
    const ord = u.searchParams.get("order"); const tri = ord ? " order by " + ord.split(",").map((o) => ident(o.split(".")[0]) + (o.endsWith(".desc") ? " desc" : "")).join(", ") : "";
    return [200, (await sql("select " + cols + " from public." + t + ou + tri, a)).rows];
  } catch (e) { return [400, { message: e.message }]; }
}
const brevo = [];
global.fetch = async (url, init = {}) => {
  init.headers = init.headers || {};
  const rep = (s, d) => ({ ok: s < 300, status: s, json: async () => d, text: async () => (d == null ? "" : JSON.stringify(d)) });
  if (url.startsWith("https://api.stripe.com/v1/")) {
    const chemin = new URL(url).pathname.replace("/v1/", "");
    if (init.method === "POST" && chemin === "checkout/sessions") {
      const cle = init.headers["Idempotency-Key"]; if (cle && ST.idem[cle]) return rep(200, ST.idem[cle]);
      const f = Object.fromEntries(new URLSearchParams(init.body)), id = "cs_test_" + (++n);
      const s = { id, url: "https://checkout.stripe.test/" + id, payment_status: "unpaid", created: Math.floor(Date.now() / 1000), metadata: {}, amount_total: Number(f["line_items[0][price_data][unit_amount]"]), params: f };
      for (const k of Object.keys(f)) { const mm = k.match(/^metadata\[(.+)\]$/); if (mm) s.metadata[mm[1]] = f[k]; }
      ST.sessions[id] = s; if (cle) ST.idem[cle] = s; return rep(200, s);
    }
    const mm = chemin.match(/^checkout\/sessions\/([^/]+)$/);
    if (mm) return ST.sessions[mm[1]] ? rep(200, ST.sessions[mm[1]]) : rep(404, { error: { message: "No such" } });
    return rep(404, {});
  }
  if (url.startsWith("https://mepcwassmoespzzsdjxf.supabase.co/")) { const [s, d] = await supabase(url, init); return rep(s, d); }
  if (url === "https://api.brevo.com/v3/smtp/email") { brevo.push(JSON.parse(init.body)); return rep(201, {}); }
  throw new Error("réseau inattendu " + url);
};
const F = (f) => require(path.join(DEPOT, "netlify/functions/" + f + ".js")).handler;
const parcours = F("parcours"), webhook = F("stripe-webhook");
const post = (corps) => parcours({ httpMethod: "POST", body: JSON.stringify(corps), headers: {} }).then((r) => ({ s: r.statusCode, b: JSON.parse(r.body) }));
function evenement(type, objet) {
  const corps = JSON.stringify({ id: "evt_p" + (++n), type, data: { object: objet } }), t = Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac("sha256", "whsec_faux").update(t + "." + corps).digest("hex");
  return webhook({ httpMethod: "POST", body: corps, headers: { "stripe-signature": "t=" + t + ",v1=" + sig } });
}
let ok = 0, ko = 0;
const v = (nom, c, d) => { if (c) { ok++; console.log("OK     " + nom); } else { ko++; console.log("ÉCHEC  " + nom + (d !== undefined ? "  → " + JSON.stringify(d).slice(0, 300) : "")); } };

(async () => {
  await db.connect();
  const x = (await db.query(`insert into public.experiences (localite_id, slug, type, titre, prix_libre_min_centimes, option_audioguide_centimes, publie)
     values ('montmartre','circuit-libre','autoguidee','{"fr":"Circuit des Peintres, à votre rythme"}',500,400,true) returning id`)).rows[0].id;
  const etape = async (ordre, type, apercu, lat, lng) => (await db.query(`insert into public.etapes (experience_id, ordre, type, apercu, nom, texte, lat, lng, audio)
     values ($1,$2,$3,$4,$5,'{"fr":"Texte secret"}',$6,$7,'{"fr":"https://exemple.invalid/a.mp3"}') returning id`, [x, ordre, type, apercu, JSON.stringify({ fr: "Étape " + ordre }), lat, lng])).rows[0].id;
  const e1 = await etape(1, "depart", false, 48.8867, 2.3431), e2 = await etape(2, "etape", true, 48.8870, 2.3400), e3 = await etape(3, "etape", false, 48.8860, 2.3380);
  await db.query("insert into public.etapes_codes (etape_id, code) values ($1, 'LAPIN')", [e3]);
  const cases = { cgv: true, acces_immediat: true, renonciation: true };

  let r = await post({ action: "acheter", slug: "circuit-libre", montant_centimes: 500, email: "a@exemple.invalid", cases: { cgv: true, acces_immediat: true } });
  v("achat sans la case de renoncement : refusé", r.s === 400 && r.b.error === "CASES");
  r = await post({ action: "acheter", slug: "circuit-libre", montant_centimes: 300, email: "a@exemple.invalid", cases });
  v("prix libre sous le minimum : refusé par la base", r.s === 400 && r.b.error === "MONTANT_TROP_BAS");
  r = await post({ action: "acheter", slug: "circuit-libre", montant_centimes: 800, audioguide: true, email: "Camille@Exemple.invalid", langue: "en", cases });
  const sess = Object.values(ST.sessions).pop();
  v("achat : session Stripe de 12 € (8 € + audioguide 4 €), retour vers l'app", r.s === 200 && sess.amount_total === 1200 && /\?parcours=\{CHECKOUT_SESSION_ID\}$/.test(sess.params.success_url), r.b);
  const ac = (await db.query("select * from public.acces where id = $1", [sess.metadata.acces_id])).rows[0];
  v("accès en attente, empreinte seule, cases et version des CGV gardées", ac.statut === "en_attente" && ac.jeton_hash === crypto.createHash("sha256").update(sess.metadata.acces_jeton).digest("hex") &&
    ac.consentements.renonciation && ac.cgv_version && ac.email === "camille@exemple.invalid", ac);
  r = await post({ action: "session", session_id: sess.id });
  v("retour sans paiement : rien d'activé", r.s === 409);
  Object.assign(sess, { payment_status: "paid", payment_intent: "pi_test_1" });
  const w = await evenement("checkout.session.completed", { id: sess.id, metadata: sess.metadata });
  v("webhook : accès activé", w.statusCode === 200 && (await db.query("select statut from public.acces where id = $1", [ac.id])).rows[0].statut === "actif");
  const mail = brevo.filter((m) => (m.tags || []).includes("parcours"));
  v("email en anglais avec le lien, le renoncement et la référence", mail.length === 1 && mail[0].htmlContent.includes("/#parcours=" + sess.metadata.acces_jeton) &&
    /L221-28, 13/.test(mail[0].htmlContent) && mail[0].htmlContent.includes(ac.reference) && /Your tour/.test(mail[0].subject), mail[0] && mail[0].subject);
  r = await post({ action: "session", session_id: sess.id });
  v("retour après le webhook : jeton rendu, pas de second email", r.s === 200 && r.b.jeton === sess.metadata.acces_jeton && brevo.filter((m) => (m.tags || []).includes("parcours")).length === 1);
  const paiements = (await db.query("select count(*)::int n from public.paiements where acces_id = $1", [ac.id])).rows[0].n;
  v("un seul paiement enregistré", paiements === 1);

  const jeton = r.b.jeton;
  r = await post({ action: "voir", jeton });
  const parE = (id) => r.b.etapes.find((e) => e.id === id);
  v("circuit : 3 étapes, départ et aperçu ouverts, étape 3 fermée sans son texte", r.s === 200 && r.b.etapes.length === 3 && parE(e1).ouverte && parE(e2).ouverte &&
    !parE(e3).ouverte && !("texte" in parE(e3)) && parE(e3).code === true && !JSON.stringify(r.b).includes("LAPIN"), r.b);
  v("audioguide payé : audio fourni", parE(e1).audio && parE(e1).audio.fr);
  r = await post({ action: "etape", jeton, etape_id: e3, lat: 48.8900, lng: 2.3500, precision: 10 });
  v("trop loin : refusé avec la distance", r.s === 403 && r.b.error === "TROP_LOIN" && r.b.distance_m > 500, r.b);
  r = await post({ action: "etape", jeton, etape_id: e3, code: "mauvais" });
  v("mauvais code : refusé", r.s === 403 && r.b.error === "CODE");
  r = await post({ action: "etape", jeton, etape_id: e3, lat: 48.88602, lng: 2.33805, precision: 8 });
  v("sur place (à quelques mètres) : étape ouverte avec son texte", r.s === 200 && r.b.etape.texte.fr === "Texte secret", r.b);
  r = await post({ action: "voir", jeton });
  v("progression gardée", r.b.etapes.find((e) => e.id === e3).ouverte === true);
  r = await post({ action: "voir", jeton: "ab".repeat(32) });
  v("jeton inconnu : refusé", r.s === 404);

  // Lien perdu : un nouveau lien remplace l'ancien
  r = await post({ action: "lien", email: "camille@exemple.invalid" });
  v("lien demandé trop tôt après l'achat : pas de second email (20 min)", r.s === 200 && brevo.filter((m) => (m.tags || []).includes("parcours")).length === 1);
  await db.query("update public.acces set lien_envoye_le = now() - interval '1 hour' where id = $1", [ac.id]);
  r = await post({ action: "lien", email: "camille@exemple.invalid" });
  const m2 = brevo.filter((m) => (m.tags || []).includes("parcours")).pop();
  const nouveau = (m2.htmlContent.match(/#parcours=([0-9a-f]{64})/) || [])[1];
  v("nouveau lien envoyé, différent de l'ancien", nouveau && nouveau !== jeton);
  v("l'ancien lien ne marche plus, le nouveau oui", (await post({ action: "voir", jeton })).s === 404 && (await post({ action: "voir", jeton: nouveau })).s === 200);
  r = await post({ action: "lien", email: "personne@exemple.invalid" });
  v("adresse sans accès : même réponse", r.s === 200 && r.b.ok === true);

  await db.query("delete from public.paiements where acces_id = $1", [ac.id]);
  await db.query("delete from public.acces where experience_id = $1", [x]);
  await db.query("delete from public.experiences where id = $1", [x]);
  await db.end();
  console.log("\n" + ok + " réussis, " + ko + " en échec"); process.exit(ko ? 1 : 0);
})().catch(async (e) => { console.error(e); process.exit(2); });
