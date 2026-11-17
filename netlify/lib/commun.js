/* ============================================================
   OUTILS PARTAGÉS DES FONCTIONS NETLIFY
   (dossier hors de netlify/functions : ce n'est pas une fonction,
   le bundler de Netlify l'inclut là où il est requis)

   Variables d'environnement Netlify (jamais dans le dépôt) :
   - STRIPE_SECRET_KEY      clé secrète Stripe
   - STRIPE_WEBHOOK_SECRET  secret de signature du webhook (whsec_…)
   - SUPABASE_SECRET_KEY    clé secrète Supabase (sb_secret_… ou service_role)
   - BREVO_API_KEY          clé API Brevo (envoi des emails)
   - SUPABASE_URL, SITE_URL, EMAIL_EXPEDITEUR : facultatives
   ============================================================ */

const crypto = require("crypto");

const SUPABASE_URL = (process.env.SUPABASE_URL || "https://mepcwassmoespzzsdjxf.supabase.co").replace(/\/$/, "");
const SITE_URL = (process.env.SITE_URL || "https://montmartre.app").replace(/\/$/, "");
const EMAIL_EXPEDITEUR = process.env.EMAIL_EXPEDITEUR || "bonjour@montmartre.app";
const NOM_EXPEDITEUR = "Mouvement Montmartre";

/* Produits Stripe qui donnent une carte de membre (compte Mouvement
   Montmartre). On reconnaît l'adhésion par le PRODUIT, pas par le prix :
   les anciens tarifs (12 €, 5 €) et les futurs restent pris en compte. */
const PRODUITS_ADHESION = {
  prod_QtJ7IT1fz5OdTm: "adhesion",     // « Adhésion à l'année », abonnement annuel (5 € x quantité, ancien 12 €)
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

/** Enregistre l'adhésion d'une session Checkout payée. Renvoie { email } ou null. */
async function enregistrerSession(session) {
  if (session.payment_status !== "paid" && session.payment_status !== "no_payment_required") return null;
  const formule = await formuleSession(session);
  if (!formule) return null;
  const nom = nomDeSession(session);
  if (session.mode === "subscription" && session.subscription) {
    const sub = await stripe("subscriptions/" + idDe(session.subscription), { "expand[]": "customer" });
    const r = await enregistrerAbonnement(sub, nom);
    return r ? { email: r.email } : null;
  }
  if (session.mode === "payment" && session.payment_intent) {
    const email = String((session.customer_details && session.customer_details.email) || "").trim().toLowerCase();
    if (!emailValide(email)) return null;
    const r = await rpc("enregistrer_adhesion_ponctuelle", {
      p_payment_intent: idDe(session.payment_intent), p_customer: idDe(session.customer),
      p_email: email, p_nom: nom, p_formule: formule, p_paye_le: iso(session.created),
    });
    return { email: r.email };
  }
  return null;
}

module.exports = {
  SITE_URL, EMAIL_EXPEDITEUR, NOM_EXPEDITEUR, PRODUITS_ADHESION, LIENS_PONCTUELS,
  json, sha256hex, nouveauJeton, jetonValide, emailValide,
  rpc, table, stripe, signatureStripeValide,
  idDe, iso, periode, nomDeSession, formuleAbonnement, enregistrerAbonnement, enregistrerSession,
};
