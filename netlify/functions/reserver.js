/* ============================================================
   FONCTION NETLIFY — reserver
   POST { seance_id, personnes, nom, email, telephone, langue,
          consentements: { cgv, non_remboursable, sans_retractation,
                           prelevement, age, photos } }
   Chaque case cochée est gardée avec son heure et la version des CGV.
   1. Bloque les places 15 minutes (base, prix calculés par la base).
   2. Crée la session de paiement Stripe et renvoie son adresse.
   Pour une visite ou un atelier, la carte est gardée (accord donné)
   pour d'éventuels frais d'annulation tardive ou d'absence.
   Adhérent (email d'une adhésion valable, vérifié par la base) : rien à
   payer, la carte est seulement enregistrée (Checkout en mode « setup »).
   Si Stripe échoue, les places sont libérées tout de suite.
   POST { action: "adherent", email } : l'email est-il celui d'une
   adhésion valable ? (affichage du formulaire, la base recalcule tout).
   ============================================================ */

const { SITE_URL, CGV_VERSION, json, rpc, stripePost, emailValide } = require("../lib/commun");

const ERREURS = {
  CGV_NON_ACCEPTEES: 400, ACCORD_FRAIS_REQUIS: 400, TELEPHONE_REQUIS: 400, NOMBRE_INVALIDE: 400,
  CONSENTEMENTS_MANQUANTS: 400, AGE_NON_CONFIRME: 400,
  SEANCE_INDISPONIBLE: 409, COMPLET: 409,
};
const MENTION_FRAIS = {
  fr: "Votre carte est enregistrée pour d'éventuels frais d'annulation tardive (moins de 24 h avant) ou d'absence, au profit de l'association, selon les conditions acceptées.",
  en: "Your card is saved for a possible late cancellation (less than 24 hours before) or no-show fee, for the association, as agreed.",
  es: "Tu tarjeta se guarda para posibles gastos de cancelación tardía (menos de 24 h antes) o de ausencia, a favor de la asociación, según las condiciones aceptadas.",
};
const uuidValide = (s) => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST attendu" });
  let p;
  try { p = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Corps invalide" }); }

  if (p.action === "adherent") {
    const em = String(p.email || "").trim().toLowerCase();
    if (!emailValide(em)) return json(400, { error: "EMAIL" });
    try { return json(200, await rpc("adhesion_pour_reservation", { p_email: em })); }
    catch (e) { console.error("reserver adherent", e.message); return json(500, { error: "ERREUR" }); }
  }

  const langue = ["fr", "en", "es"].includes(p.langue) ? p.langue : "fr";
  const email = String(p.email || "").trim().toLowerCase();
  const nom = String(p.nom || "").trim().slice(0, 120);
  const personnes = Number.parseInt(p.personnes, 10);
  const telephone = String(p.telephone || "").trim().slice(0, 30);
  if (!uuidValide(p.seance_id) || !nom || !emailValide(email) || !Number.isInteger(personnes)) {
    return json(400, { error: "Paramètres invalides", code: "PARAMETRES" });
  }

  // Seules les cases connues, et seulement si elles sont vraiment cochées (true).
  const c = p.consentements && typeof p.consentements === "object" ? p.consentements : {};
  const consentements = {};
  for (const k of ["cgv", "non_remboursable", "sans_retractation", "prelevement", "age", "photos"]) {
    if (c[k] === true) consentements[k] = true;
  }

  let resa;
  try {
    resa = await rpc("reserver_places", {
      p_seance_id: p.seance_id, p_personnes: personnes, p_nom: nom, p_email: email,
      p_telephone: telephone || null, p_langue: langue,
      p_consentements: consentements, p_cgv_version: CGV_VERSION,
    });
  } catch (e) {
    const code = Object.keys(ERREURS).find((k) => (e.message || "").includes(k));
    if (code) return json(ERREURS[code], { error: code, code });
    console.error("reserver", e.message);
    return json(500, { error: "Réservation impossible pour le moment", code: "ERREUR" });
  }

  const titre = (resa.experience_titre && (resa.experience_titre[langue] || resa.experience_titre.fr)) || "Visite";
  const quand = new Intl.DateTimeFormat({ fr: "fr-FR", en: "en-GB", es: "es-ES" }[langue], {
    timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  }).format(new Date(resa.debut));

  const params = {
    mode: "payment",
    locale: langue,
    customer_email: email,
    customer_creation: "always",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": String(resa.a_payer_centimes),
    "line_items[0][price_data][product_data][name]": (titre + ", " + quand).slice(0, 250),
    "line_items[0][price_data][product_data][description]":
      (resa.reste_sur_place_centimes > 0
        ? { fr: "Pré-réservation de " + personnes + " place(s). Le reste se règle sur place.",
            en: "Booking fee for " + personnes + " spot(s). The rest is paid on site.",
            es: "Prerreserva de " + personnes + " plaza(s). El resto se paga en el lugar." }[langue]
        : { fr: personnes + " place(s)", en: personnes + " spot(s)", es: personnes + " plaza(s)" }[langue]),
    "metadata[reservation_id]": resa.reservation_id,
    "payment_intent_data[metadata][reservation_id]": resa.reservation_id,
    "payment_intent_data[description]": "Réservation " + resa.reference,
    expires_at: String(Math.floor(Date.now() / 1000) + 30 * 60),   // minimum imposé par Stripe : 30 min
    success_url: SITE_URL + "/?reservation={CHECKOUT_SESSION_ID}",
    cancel_url: SITE_URL + "/?reservation_abandonnee=1",
  };
  if (resa.garder_carte) {
    params["payment_intent_data[setup_future_usage]"] = "off_session";
    params["custom_text[submit][message]"] = MENTION_FRAIS[langue];
  }

  let s;
  if (resa.a_payer_centimes === 0) {
    // Adhérent : pré-réservation offerte. La carte est enregistrée sans débit, au nom d'un client
    // Stripe créé pour l'occasion (indispensable pour un prélèvement ultérieur hors session).
    const client = await stripePost("customers", { email, name: nom, "metadata[reservation_id]": resa.reservation_id },
      "client-" + resa.reservation_id).catch((e) => ({ ok: false, data: { error: { message: e.message } } }));
    s = client.ok ? await stripePost("checkout/sessions", {
      mode: "setup", locale: langue, customer: client.data.id,
      "payment_method_types[0]": "card",
      "metadata[reservation_id]": resa.reservation_id,
      "setup_intent_data[metadata][reservation_id]": resa.reservation_id,
      "setup_intent_data[description]": ("Réservation " + resa.reference + " (adhérent), " + titre + ", " + quand).slice(0, 500),
      expires_at: params.expires_at, success_url: params.success_url, cancel_url: params.cancel_url,
    }, "resa-" + resa.reservation_id).catch((e) => ({ ok: false, data: { error: { message: e.message } } })) : client;
  } else {
    s = await stripePost("checkout/sessions", params, "resa-" + resa.reservation_id)
      .catch((e) => ({ ok: false, data: { error: { message: e.message } } }));
  }
  if (!s.ok) {
    console.error("reserver stripe", s.data && s.data.error && s.data.error.message);
    await rpc("liberer_reservation", { p_stripe_session_id: null, p_reservation_id: resa.reservation_id }).catch(() => {});
    return json(502, { error: "Paiement indisponible pour le moment", code: "STRIPE" });
  }
  return json(200, { url: s.data.url, reference: resa.reference, adherent: !!resa.adherent });
};
