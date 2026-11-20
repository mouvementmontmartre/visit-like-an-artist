/* ============================================================
   FONCTION NETLIFY — reserver (décision du 21/11 : visites, ateliers et
   séances « réservées aux adhérents » sont réservés aux adhérents)
   POST { … } :
   - { action: "adherent", jeton } : adhésion du titulaire de la carte
       enregistrée sur ce téléphone (jeton obtenu avec le code reçu par
       email, ou au retour du paiement de l'adhésion).
   Sécurité (21/11) : réserver en adhérent exige ce jeton, et l'email de
   la réservation doit être celui de la carte. Sans lui, une adresse
   d'adhérent est refusée (VERIFICATION_REQUISE) : personne ne peut
   réserver au nom d'un adhérent ni faire prélever sa carte.
   - { action: "adhesion", seance_id, personnes, nom, email, telephone,
       langue, accord_adhesion: true } (E8.0) : retient la place 15 min
       et ouvre le paiement de l'adhésion (abonnement 5 €/an) ; au retour,
       l'app termine la réservation (« finaliser »).
   - { action: "finaliser", reservation_id, email, consentements: { conditions } }
       : la place retenue devient une réservation (adhésion vérifiée).
   - { seance_id, personnes, nom, email, telephone, langue,
       consentements: { conditions } } : réservation d'un adhérent (E8.1,
       E8.2 ; 0 € en ligne) ou d'une soirée (prix payé en ligne).
   Adhérent : la carte de l'abonnement sert aux frais d'absence ou
   d'annulation à moins de 24 h ; sans carte (ancien adhérent), Stripe
   l'enregistre sans débit (mode « setup »). La réservation est alors
   confirmée tout de suite et le lien personnel rendu.
   Si Stripe échoue, les places sont libérées tout de suite.
   ============================================================ */

const { SITE_URL, CGV_VERSION, json, rpc, stripePost, emailValide, sha256hex, sessionAdhesion, carteAdhesion } = require("../lib/commun");
const { toutTraiter } = require("../lib/reservations");

const ERREURS = {
  CONDITIONS_NON_ACCEPTEES: 400, TELEPHONE_REQUIS: 400, NOMBRE_INVALIDE: 400, PARAMETRES: 400,
  ADHESION_REQUISE: 403, DEJA_ADHERENT: 409, ADHESION_INUTILE: 409,
  SEANCE_INDISPONIBLE: 409, COMPLET: 409, RESERVATION_INTROUVABLE: 404,
};
const MENTION_FRAIS = {
  fr: "Votre carte est enregistrée pour d'éventuels frais d'annulation tardive (moins de 24 h avant) ou d'absence, au profit de l'association, selon les conditions acceptées.",
  en: "Your card is saved for a possible late cancellation (less than 24 hours before) or no-show fee, for the association, as agreed.",
  es: "Tu tarjeta se guarda para posibles gastos de cancelación tardía (menos de 24 h antes) o de ausencia, a favor de la asociación, según las condiciones aceptadas.",
};
const uuidValide = (s) => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const erreurBase = (e, contexte) => {
  const code = Object.keys(ERREURS).find((k) => (e.message || "").includes(k));
  if (code) return json(ERREURS[code], { error: code, code });
  console.error(contexte, e.message);
  return json(500, { error: "Réservation impossible pour le moment", code: "ERREUR" });
};
const echecStripe = (e) => ({ ok: false, data: { error: { message: e.message } } });

/** Réservation sans paiement (adhérent) : confirmée avec la carte de l'adhésion, ou envoi vers
    Stripe pour enregistrer une carte sans débit (ancien adhérent sans carte). */
async function confirmerSansPaiement(resa, { email, nom, langue }) {
  let carte = await carteAdhesion(email).catch(() => null);
  if (!carte && !resa.garder_carte) carte = { customer: null, pm: "sans_frais" };   // aucune règle de frais : pas de carte
  if (carte) {
    const r = await rpc("confirmer_reservation", { p_reservation_id: resa.reservation_id, p_stripe_session_id: null,
      p_stripe_payment_intent: null, p_montant_centimes: 0, p_stripe_customer: carte.customer, p_stripe_payment_method: carte.pm });
    const lien = await rpc("lien_reservation_par_id", { p_reservation_id: resa.reservation_id });
    await toutTraiter().catch(() => {});        // confirmation et alertes tout de suite
    const reservation = await rpc("reservation_par_jeton", { p_jeton_hash: sha256hex(lien.jeton) });
    return json(200, { confirmee: r.statut === "confirmee", jeton: lien.jeton, reservation, reference: resa.reference });
  }
  const client = await stripePost("customers", { email, name: nom, "metadata[type]": "adherent",
    "metadata[reservation_id]": resa.reservation_id }, "client-" + resa.reservation_id).catch(echecStripe);
  const s = client.ok ? await stripePost("checkout/sessions", {
    mode: "setup", locale: langue, customer: client.data.id, "payment_method_types[0]": "card",
    "metadata[reservation_id]": resa.reservation_id, "metadata[type]": "carte_reservation",
    "setup_intent_data[metadata][reservation_id]": resa.reservation_id, "setup_intent_data[metadata][type]": "carte_reservation",
    "setup_intent_data[description]": ("Carte pour les frais d'absence, réservation " + resa.reference).slice(0, 500),
    expires_at: String(Math.floor(Date.now() / 1000) + 30 * 60),
    success_url: SITE_URL + "/?reservation={CHECKOUT_SESSION_ID}", cancel_url: SITE_URL + "/?reservation_abandonnee=1",
  }, "resa-" + resa.reservation_id).catch(echecStripe) : client;
  if (!s.ok) {
    console.error("reserver carte", s.data && s.data.error && s.data.error.message);
    await rpc("liberer_reservation", { p_stripe_session_id: null, p_reservation_id: resa.reservation_id }).catch(() => {});
    return json(502, { error: "Paiement indisponible pour le moment", code: "STRIPE" });
  }
  return json(200, { url: s.data.url, reference: resa.reference, carte_a_enregistrer: true });
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST attendu" });
  let p;
  try { p = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Corps invalide" }); }

  const langue = ["fr", "en", "es"].includes(p.langue) ? p.langue : "fr";
  const email = String(p.email || "").trim().toLowerCase();
  const nom = String(p.nom || "").trim().slice(0, 120);
  const telephone = String(p.telephone || "").trim().slice(0, 30);
  const conditions = !!(p.consentements && p.consentements.conditions === true);

  try {
    // Email prouvé par la carte enregistrée sur ce téléphone (ou rien).
    const emailVerifie = /^[A-Za-z0-9_-]{43}$/.test(String(p.jeton || ""))
      ? await rpc("carte_email", { p_jeton_hash: sha256hex(p.jeton) }).catch(() => null) : null;

    if (p.action === "adherent") {
      if (!emailVerifie) return json(200, { adherent: false });
      const a = await rpc("adhesion_pour_reservation", { p_email: emailVerifie });
      if (a && a.adherent) {
        const c = await rpc("adhesion_carte", { p_email: emailVerifie }).catch(() => null);
        a.carte = !!(c && c.stripe_subscription);
      }
      return json(200, Object.assign(a || {}, { email: emailVerifie }));
    }

    if (p.action === "adhesion") {
      const personnes = Number.parseInt(p.personnes, 10);
      if (!uuidValide(p.seance_id) || !nom || !emailValide(email) || !Number.isInteger(personnes)) return json(400, { code: "PARAMETRES" });
      if (p.accord_adhesion !== true) return json(400, { code: "ACCORD_ADHESION" });
      let h;
      try {
        h = await rpc("retenir_pour_adhesion", { p_seance_id: p.seance_id, p_personnes: personnes, p_nom: nom,
          p_email: email, p_telephone: telephone || null, p_langue: langue });
      } catch (e) { return erreurBase(e, "reserver adhesion"); }
      const s = await sessionAdhesion({ email, nom, telephone, langue, reservationId: h.reservation_id, seanceId: p.seance_id }).catch(echecStripe);
      if (!s.ok) {
        console.error("reserver adhesion stripe", s.data && s.data.error && s.data.error.message);
        await rpc("liberer_reservation", { p_stripe_session_id: null, p_reservation_id: h.reservation_id }).catch(() => {});
        return json(502, { error: "Paiement indisponible pour le moment", code: "STRIPE" });
      }
      return json(200, { url: s.data.url, reservation_id: h.reservation_id, bloque_jusqua: h.bloque_jusqua });
    }

    if (p.action === "finaliser") {
      if (!uuidValide(p.reservation_id) || !emailValide(email)) return json(400, { code: "PARAMETRES" });
      if (emailVerifie !== email) return json(403, { error: "VERIFICATION_REQUISE", code: "VERIFICATION_REQUISE" });
      let resa;
      try {
        resa = await rpc("finaliser_reservation_adherent", { p_reservation_id: p.reservation_id, p_email: email,
          p_consentements: { conditions }, p_cgv_version: CGV_VERSION });
      } catch (e) { return erreurBase(e, "reserver finaliser"); }
      return confirmerSansPaiement(resa, { email, nom: nom || null, langue });
    }

    const personnes = Number.parseInt(p.personnes, 10);
    if (!uuidValide(p.seance_id) || !nom || !emailValide(email) || !Number.isInteger(personnes)) {
      return json(400, { error: "Paramètres invalides", code: "PARAMETRES" });
    }
    // Adresse d'un adhérent sans la preuve (carte de ce téléphone) : code à demander d'abord.
    if (emailVerifie !== email) {
      const a = await rpc("adhesion_pour_reservation", { p_email: email });
      if (a && a.adherent) return json(403, { error: "VERIFICATION_REQUISE", code: "VERIFICATION_REQUISE" });
    }
    let resa;
    try {
      resa = await rpc("reserver_places", {
        p_seance_id: p.seance_id, p_personnes: personnes, p_nom: nom, p_email: email,
        p_telephone: telephone || null, p_langue: langue,
        p_consentements: conditions ? { conditions: true } : {}, p_cgv_version: CGV_VERSION,
      });
    } catch (e) { return erreurBase(e, "reserver"); }

    if (resa.a_payer_centimes === 0) return confirmerSansPaiement(resa, { email, nom, langue });

    // Soirée (ou autre séance payée en ligne) : paiement du prix.
    const titre = (resa.experience_titre && (resa.experience_titre[langue] || resa.experience_titre.fr)) || "ArtDive";
    const quand = new Intl.DateTimeFormat({ fr: "fr-FR", en: "en-GB", es: "es-ES" }[langue], {
      timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
    }).format(new Date(resa.debut));
    const params = {
      mode: "payment", locale: langue, customer_email: email, customer_creation: "always",
      "line_items[0][quantity]": "1",
      "line_items[0][price_data][currency]": "eur",
      "line_items[0][price_data][unit_amount]": String(resa.a_payer_centimes),
      "line_items[0][price_data][product_data][name]": (titre + ", " + quand).slice(0, 250),
      "line_items[0][price_data][product_data][description]": { fr: personnes + " place(s)", en: personnes + " spot(s)", es: personnes + " plaza(s)" }[langue],
      "metadata[reservation_id]": resa.reservation_id, "metadata[type]": "reservation", "metadata[seance_id]": p.seance_id,
      "payment_intent_data[metadata][reservation_id]": resa.reservation_id,
      "payment_intent_data[metadata][type]": "reservation", "payment_intent_data[metadata][seance_id]": p.seance_id,
      "payment_intent_data[description]": "Réservation " + resa.reference,
      expires_at: String(Math.floor(Date.now() / 1000) + 30 * 60),   // minimum imposé par Stripe : 30 min
      success_url: SITE_URL + "/?reservation={CHECKOUT_SESSION_ID}",
      cancel_url: SITE_URL + "/?reservation_abandonnee=1",
    };
    if (resa.garder_carte) {
      params["payment_intent_data[setup_future_usage]"] = "off_session";
      params["custom_text[submit][message]"] = MENTION_FRAIS[langue];
    }
    const s = await stripePost("checkout/sessions", params, "resa-" + resa.reservation_id).catch(echecStripe);
    if (!s.ok) {
      console.error("reserver stripe", s.data && s.data.error && s.data.error.message);
      await rpc("liberer_reservation", { p_stripe_session_id: null, p_reservation_id: resa.reservation_id }).catch(() => {});
      return json(502, { error: "Paiement indisponible pour le moment", code: "STRIPE" });
    }
    return json(200, { url: s.data.url, reference: resa.reference });
  } catch (e) {
    console.error("reserver", p && p.action, e.message);
    return json(500, { error: "Réservation impossible pour le moment", code: "ERREUR" });
  }
};
