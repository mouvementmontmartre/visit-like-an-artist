/* ============================================================
   OUTILS PARTAGÉS DES FONCTIONS NETLIFY
   (dossier hors de netlify/functions : ce n'est pas une fonction,
   le bundler de Netlify l'inclut là où il est requis)

   Variables d'environnement Netlify (jamais dans le dépôt) :
   - STRIPE_SECRET_KEY      clé secrète Stripe
   - STRIPE_WEBHOOK_SECRET  secret de signature du webhook (whsec_…)
   - SUPABASE_SECRET_KEY    clé secrète Supabase (sb_secret_… ou service_role)
   - BREVO_API_KEY          clé API Brevo (envoi des emails)
   - SUPABASE_URL, SITE_URL, EMAIL_EXPEDITEUR, EMAIL_REPONSE : facultatives
   - NOTIFY_EMAIL           facultative : adresse qui reçoit les emails d'information
                            de l'association (sinon EMAIL_REPONSE)
   - STRIPE_PRIX_ADHESION   facultative : prix de l'abonnement d'adhésion (par défaut 5 €/an)
   ============================================================ */

const crypto = require("crypto");

const SUPABASE_URL = (process.env.SUPABASE_URL || "https://mepcwassmoespzzsdjxf.supabase.co").replace(/\/$/, "");
const SITE_URL = (process.env.SITE_URL || "https://artdive.app").replace(/\/$/, "");
const EMAIL_EXPEDITEUR = process.env.EMAIL_EXPEDITEUR || "bonjour@artdive.app";
/* Version des CGV en vigueur (date). À changer à chaque nouvelle version publiée dans cgv.html :
   chaque réservation garde la version acceptée. */
const CGV_VERSION = "2026-11-21";
/* Version du texte accepté à l'adhésion (statuts, règlement, confidentialité), gardée au registre. */
const ADHESION_VERSION = "adhesion-2026-11-21";
/* Abonnement d'adhésion : « Adhésion annuelle », 5 € par an (produit prod_QtJ7IT1fz5OdTm). */
const PRIX_ADHESION = process.env.STRIPE_PRIX_ADHESION || "price_1UcTj6Ctjp0QuQA6wHW2K8zR";
const NOM_EXPEDITEUR = "Mouvement Montmartre";
/* Les réponses des destinataires arrivent ici (artdive.app n'a pas de boîte mail). */
const EMAIL_REPONSE = process.env.EMAIL_REPONSE || "mouvementmontmartre@gmail.com";

/* Produits Stripe qui donnent une carte de membre (compte Mouvement
   Montmartre). On reconnaît l'adhésion par le PRODUIT, pas par le prix :
   les anciens tarifs (12 €, 5 €) et les futurs restent pris en compte. */
const PRODUITS_ADHESION = {
  prod_QtJ7IT1fz5OdTm: "adhesion",     // « Adhésion annuelle », abonnement 5 €/an (anciens abonnements à 12 € passés à 5 € au renouvellement, 21/11)
  prod_TOOZOTIr3wJsYq: "adhesion",     // « Adhésion à l'année », paiement ponctuel (valable un an)
  prod_Oxr9yYcyaqlt6J: "bienfaiteur",  // « Bienfaiteur de Montmartre », abonnement mensuel (mécénat)
};
/* Lien de paiement ponctuel d'adhésion (pour l'import des paiements passés). */
const LIENS_PONCTUELS = ["plink_1SRbm0Ctjp0QuQA6HA5b0bmd"];

const json = (statusCode, body) => ({
  statusCode,
  headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  body: JSON.stringify(body),
});

const sha256hex = (s) => crypto.createHash("sha256").update(String(s), "utf8").digest("hex");
const nouveauJeton = () => crypto.randomBytes(32).toString("base64url");   // 43 caractères
const jetonValide = (j) => typeof j === "string" && /^[A-Za-z0-9_-]{43}$/.test(j);
const emailValide = (e) => typeof e === "string" && e.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

/* ---------- Supabase (clé secrète, côté serveur uniquement) ---------- */

function enTetesSupabase() {
  const cle = process.env.SUPABASE_SECRET_KEY;
  if (!cle) throw new Error("SUPABASE_SECRET_KEY absente");
  const h = { apikey: cle, "Content-Type": "application/json" };
  // Les anciennes clés (JWT service_role) passent aussi en Authorization ;
  // les nouvelles (sb_secret_…) seulement en apikey.
  if (!cle.startsWith("sb_")) h.Authorization = "Bearer " + cle;
  return h;
}

/** Appelle une fonction SQL publique (rpc). Renvoie sa valeur, ou lève une erreur. */
async function rpc(nom, args) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/rpc/" + nom, {
    method: "POST",
    headers: enTetesSupabase(),
    body: JSON.stringify(args || {}),
  });
  const texte = await res.text();
  const data = texte ? JSON.parse(texte) : null;
  if (!res.ok) {
    const err = new Error((data && (data.message || data.hint)) || ("Supabase " + res.status));
    err.code = data && data.message;
    throw err;
  }
  return data;
}

/** Requête directe sur une table (serveur uniquement). */
async function table(methode, chemin, corps, enTetes) {
  const res = await fetch(SUPABASE_URL + "/rest/v1/" + chemin, {
    method: methode,
    headers: Object.assign(enTetesSupabase(), enTetes || {}),
    body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await res.text();
  if (!res.ok) throw new Error("Supabase " + res.status + " " + texte.slice(0, 200));
  return texte ? JSON.parse(texte) : null;
}

/** Supabase Auth, API d'administration (clé secrète) : chemin sous /auth/v1/. */
async function authAdmin(methode, chemin, corps) {
  const res = await fetch(SUPABASE_URL + "/auth/v1/" + chemin, {
    method: methode, headers: enTetesSupabase(), body: corps === undefined ? undefined : JSON.stringify(corps),
  });
  const texte = await res.text();
  let data = null;
  try { data = texte ? JSON.parse(texte) : null; } catch (e) { /* réponse non JSON */ }
  return { ok: res.ok, status: res.status, data };
}

/** Qui appelle ? Vérifie le jeton de session envoyé par l'app et rend { id, role } ou null. */
async function appelant(event) {
  const h = (event.headers && (event.headers.authorization || event.headers.Authorization)) || "";
  const jeton = h.replace(/^Bearer\s+/i, "");
  if (!/^[A-Za-z0-9._-]{20,4096}$/.test(jeton)) return null;
  const res = await fetch(SUPABASE_URL + "/auth/v1/user", {
    headers: { apikey: process.env.SUPABASE_SECRET_KEY || "", Authorization: "Bearer " + jeton },
  });
  if (!res.ok) return null;
  const u = await res.json();
  if (!u || !u.id) return null;
  const p = await table("GET", "profils?select=role,intervenant_id&user_id=eq." + encodeURIComponent(u.id));
  return { id: u.id, email: u.email, role: (p && p[0] && p[0].role) || null };
}

/** Envoi d'un email par Brevo. m = { sujet, html, texte }. */
async function envoyerBrevo(destinataire, m, tags, repondreA) {
  if (!process.env.BREVO_API_KEY) throw new Error("BREVO_API_KEY absente");
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: NOM_EXPEDITEUR, email: EMAIL_EXPEDITEUR },
      replyTo: repondreA || { name: NOM_EXPEDITEUR, email: EMAIL_REPONSE },
      to: [{ email: destinataire }],
      subject: m.sujet, htmlContent: m.html, textContent: m.texte, tags: tags || [],
    }),
  });
  if (!res.ok) throw new Error("Brevo " + res.status + " " + (await res.text()).slice(0, 200));
}

/* ---------- Stripe ---------- */

async function stripe(chemin, params) {
  const cle = process.env.STRIPE_SECRET_KEY;
  if (!cle) throw new Error("STRIPE_SECRET_KEY absente");
  const qs = params ? "?" + new URLSearchParams(params).toString() : "";
  const res = await fetch("https://api.stripe.com/v1/" + chemin + qs, {
    headers: { Authorization: "Bearer " + cle },
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data.error && data.error.message) || "Stripe " + res.status);
  return data;
}

/** Écriture Stripe (POST). La clé d'idempotence garantit qu'un même
    remboursement ou prélèvement n'est jamais fait deux fois, même si
    l'appel est répété. Renvoie { ok, status, data }. */
async function stripePost(chemin, params, cleIdempotence) {
  const cle = process.env.STRIPE_SECRET_KEY;
  if (!cle) throw new Error("STRIPE_SECRET_KEY absente");
  const h = { Authorization: "Bearer " + cle, "Content-Type": "application/x-www-form-urlencoded" };
  if (cleIdempotence) h["Idempotency-Key"] = cleIdempotence;
  const res = await fetch("https://api.stripe.com/v1/" + chemin, {
    method: "POST", headers: h, body: new URLSearchParams(params).toString(),
  });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

/** Vérifie la signature d'un webhook Stripe (en-tête Stripe-Signature). */
function signatureStripeValide(corpsBrut, entete, secret, toleranceSec = 300) {
  if (!entete || !secret) return false;
  const parts = {};
  String(entete).split(",").forEach((kv) => {
    const i = kv.indexOf("=");
    if (i > 0) {
      const k = kv.slice(0, i).trim(), v = kv.slice(i + 1).trim();
      (parts[k] = parts[k] || []).push(v);
    }
  });
  const t = parts.t && parts.t[0];
  if (!t || !/^\d+$/.test(t) || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return false;
  const attendu = crypto.createHmac("sha256", secret).update(t + "." + corpsBrut, "utf8").digest("hex");
  return parts.v1.some((sig) => {
    if (!/^[0-9a-f]{64}$/.test(sig)) return false;
    return crypto.timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(attendu, "hex"));
  });
}

/* ---------- Adhésions ---------- */

const iso = (sec) => (sec ? new Date(sec * 1000).toISOString() : null);
const idDe = (x) => (x && typeof x === "object" ? x.id : x) || null;

/** Formule d'un abonnement (adhesion / bienfaiteur), ou null s'il n'en donne pas. */
function formuleAbonnement(sub) {
  const items = (sub.items && sub.items.data) || [];
  for (const it of items) {
    const prod = idDe(it.price && it.price.product);
    if (PRODUITS_ADHESION[prod]) return PRODUITS_ADHESION[prod];
  }
  return null;
}

/** Période en cours (sur l'abonnement, ou sur ses lignes depuis l'API 2025). */
function periode(sub) {
  const it = ((sub.items && sub.items.data) || [])[0] || {};
  return {
    debut: sub.current_period_start || it.current_period_start || null,
    fin: sub.current_period_end || it.current_period_end || null,
  };
}

/** Nom saisi dans le champ « Prénom Nom » du paiement, sinon celui de Stripe. */
function nomDeSession(session) {
  const champ = (session.custom_fields || []).find((f) => /pr[eé]?nom/i.test(f.key || "") && f.text && f.text.value);
  return (champ && champ.text.value) || (session.customer_details && session.customer_details.name) || null;
}

/** Enregistre (ou met à jour) un abonnement d'adhésion à partir de l'objet Stripe. */
async function enregistrerAbonnement(sub, nom) {
  const formule = formuleAbonnement(sub);
  if (!formule) return null;
  let client = sub.customer;
  if (!client || typeof client !== "object") client = await stripe("customers/" + idDe(sub.customer));
  const email = String((client && client.email) || "").trim().toLowerCase();
  const { debut, fin } = periode(sub);

  // Validité = période déjà payée.
  let statut = "active", jusqua = null;
  if (sub.status === "active" || sub.status === "trialing") jusqua = iso(fin);
  else if (sub.status === "canceled") statut = "arretee";            // garder la date payée
  else jusqua = iso(debut);                                          // impayé : jusqu'au début de la période impayée

  const args = {
    p_subscription: sub.id, p_customer: idDe(client), p_email: email || null,
    p_nom: nom || (client && client.name) || null, p_formule: formule,
    p_debut: iso(sub.start_date) || iso(debut), p_valide_jusqua: jusqua, p_statut: statut,
  };
  try {
    return await rpc("enregistrer_adhesion_abonnement", args);
  } catch (e) {
    // Abonnement déjà arrêté et jamais vu : on retient sa date de fin.
    if (/DATE_MANQUANTE/.test(e.message)) {
      args.p_valide_jusqua = iso(sub.ended_at) || iso(fin);
      if (!args.p_valide_jusqua || !email) return null;
      return rpc("enregistrer_adhesion_abonnement", args);
    }
    throw e;
  }
}

/** Formule d'une session Checkout payée, ou null si ce n'est pas une adhésion. */
async function formuleSession(session) {
  let lignes = session.line_items;
  if (!lignes) lignes = await stripe("checkout/sessions/" + session.id + "/line_items", { "expand[]": "data.price" });
  for (const l of (lignes && lignes.data) || []) {
    const prod = idDe(l.price && l.price.product);
    if (PRODUITS_ADHESION[prod]) return PRODUITS_ADHESION[prod];
  }
  return null;
}

/** Enregistre l'adhésion d'une session Checkout payée. Renvoie { email, id } ou null.
    Adhésion prise dans l'app : téléphone, langue et consentement (date, version) vont au registre. */
async function enregistrerSession(session) {
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return null;
  const formule = await formuleSession(session);
  if (!formule) return null;
  const meta = session.metadata || {};
  const nom = meta.nom || nomDeSession(session);
  if (session.mode === "subscription" && session.subscription) {
    const sub = await stripe("subscriptions/" + idDe(session.subscription), { "expand[]": "customer" });
    const r = await enregistrerAbonnement(sub, nom);
    if (r && meta.type === "adhesion") {
      await rpc("noter_adherent", { p_email: r.email, p_nom: nom, p_telephone: meta.telephone || null,
        p_customer: idDe(sub.customer), p_subscription: sub.id, p_langue: meta.langue || null,
        p_consentement_le: meta.consentement_le || null, p_consentement_version: meta.consentement_version || null });
    }
    return r ? { email: r.email, id: r.id } : null;
  }
  if (session.mode === "payment" && session.payment_intent) {
    const email = String((session.customer_details && session.customer_details.email) || "").trim().toLowerCase();
    if (!emailValide(email)) return null;
    const r = await rpc("enregistrer_adhesion_ponctuelle", {
      p_payment_intent: idDe(session.payment_intent), p_customer: idDe(session.customer),
      p_email: email, p_nom: nom, p_formule: formule, p_paye_le: iso(session.created),
    });
    return { email: r.email, id: r.id };
  }
  return null;
}

/** Session Stripe d'adhésion (abonnement 5 €/an, E8.0 et E15). La case « statuts, règlement,
    confidentialité » est gardée avec sa date et sa version (registre, au retour du webhook).
    reservationId : place retenue pendant le paiement (la réservation se termine dans l'app). */
async function sessionAdhesion({ email, nom, telephone, langue, reservationId, seanceId }) {
  const l = ["fr", "en", "es"].includes(langue) ? langue : "fr";
  const meta = { type: "adhesion", nom: String(nom || "").slice(0, 120), telephone: String(telephone || "").slice(0, 30),
    langue: l, consentement_le: new Date().toISOString(), consentement_version: ADHESION_VERSION };
  if (reservationId) Object.assign(meta, { reservation_retenue: reservationId, seance_id: seanceId || "" });
  const params = {
    mode: "subscription", locale: l, customer_email: email,
    "line_items[0][price]": PRIX_ADHESION, "line_items[0][quantity]": "1",
    expires_at: String(Math.floor(Date.now() / 1000) + 30 * 60),
    success_url: SITE_URL + "/?adhesion={CHECKOUT_SESSION_ID}" + (reservationId ? "&resa=" + reservationId : ""),
    cancel_url: SITE_URL + (reservationId ? "/?reservation_abandonnee=1&resa=" + reservationId : "/#membre"),
  };
  for (const [k, v] of Object.entries(meta)) {
    params["metadata[" + k + "]"] = v;
    params["subscription_data[metadata][" + k + "]"] = v;
  }
  return stripePost("checkout/sessions", params, reservationId ? "adhesion-" + reservationId : undefined);
}

/** Carte de l'adhésion en cours (abonnement) pour les frais hors session : { customer, pm } ou null. */
async function carteAdhesion(email) {
  const c = await rpc("adhesion_carte", { p_email: email });
  if (!c || !c.stripe_customer) return null;
  let pm = null;
  if (c.stripe_subscription) {
    const sub = await stripe("subscriptions/" + c.stripe_subscription).catch(() => null);
    pm = sub && idDe(sub.default_payment_method);
  }
  if (!pm) {
    const cus = await stripe("customers/" + c.stripe_customer).catch(() => null);
    pm = cus && cus.invoice_settings && idDe(cus.invoice_settings.default_payment_method);
  }
  return pm ? { customer: c.stripe_customer, pm } : null;
}

/* ---------- Connexion à l'espace (intervenants, association) ----------
   22/11 : une seule connexion par code à 6 chiffres pour tout le monde.
   Une fois l'adresse prouvée (code, ou lien de connexion d'un email), le
   serveur crée lui-même la session Supabase : lien magique généré sans
   envoi d'email (admin/generate_link), aussitôt échangé contre une session
   (/auth/v1/verify). Rien ne passe par l'adresse du navigateur. */

/** Identifiant du compte de connexion d'une adresse ; le crée si besoin (email confirmé). */
async function compteDeConnexion(email) {
  const cree = await authAdmin("POST", "admin/users", { email, email_confirm: true });
  if (cree.ok && cree.data && cree.data.id) return cree.data.id;
  if (!cree.ok && cree.status !== 422 && cree.status !== 400) throw new Error("Création du compte : " + cree.status);
  const lien = await authAdmin("POST", "admin/generate_link", { type: "magiclink", email });
  const d = lien.data || {};
  const id = d.id || (d.user && d.user.id);
  if (!lien.ok || !id) throw new Error("Compte introuvable : " + lien.status);
  return id;
}

/** Session Supabase (access_token, refresh_token, expires_at) pour une adresse dont le compte existe. */
async function sessionPour(email) {
  const lien = await authAdmin("POST", "admin/generate_link", { type: "magiclink", email });
  const d = lien.data || {};
  const hash = d.hashed_token || (d.properties && d.properties.hashed_token);
  if (!lien.ok || !hash) throw new Error("Lien de session : " + lien.status);
  const v = await authAdmin("POST", "verify", { type: "magiclink", token_hash: hash });
  const s = v.data || {};
  if (!v.ok || !s.access_token) throw new Error("Session : " + v.status);
  return { access_token: s.access_token, refresh_token: s.refresh_token,
    expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600) };
}

module.exports = {
  SITE_URL, EMAIL_EXPEDITEUR, NOM_EXPEDITEUR, EMAIL_REPONSE, CGV_VERSION, ADHESION_VERSION, PRIX_ADHESION,
  PRODUITS_ADHESION, LIENS_PONCTUELS, sessionAdhesion, carteAdhesion,
  json, sha256hex, nouveauJeton, jetonValide, emailValide,
  rpc, table, authAdmin, appelant, envoyerBrevo, compteDeConnexion, sessionPour, stripe, stripePost, signatureStripeValide,
  idDe, iso, periode, nomDeSession, formuleAbonnement, enregistrerAbonnement, enregistrerSession,
};
