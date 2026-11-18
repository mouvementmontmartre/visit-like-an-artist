/* ============================================================
   RÉSERVATIONS : CONFIRMATION ET TRAITEMENT DES FILES
   Utilisé par le webhook Stripe, la fonction « reservation » et la
   tâche planifiée « taches ». Chaque opération est sans doublon :
   - remboursement : clé d'idempotence Stripe « remb-<id> » ;
   - frais : clé « frais-<id> » ;
   - email : marqué envoyé une seule fois (file « envois »).
   ============================================================ */

const { rpc, stripe, stripePost, idDe, EMAIL_EXPEDITEUR, NOM_EXPEDITEUR, EMAIL_REPONSE, SITE_URL } = require("./commun");
const { rediger } = require("./emails");

/** Confirme la réservation d'une session Checkout payée (idempotent). */
async function confirmerSession(session) {
  const id = session.metadata && session.metadata.reservation_id;
  if (!id || session.payment_status !== "paid") return null;
  const pi = await stripe("payment_intents/" + idDe(session.payment_intent));
  return rpc("confirmer_reservation", {
    p_reservation_id: id, p_stripe_session_id: session.id, p_stripe_payment_intent: pi.id,
    p_montant_centimes: session.amount_total, p_stripe_customer: idDe(pi.customer) || idDe(session.customer),
    p_stripe_payment_method: idDe(pi.payment_method),
  });
}

async function envoyerEmail(envoi) {
  const m = rediger(envoi);
  const corps = {
    sender: { name: NOM_EXPEDITEUR, email: EMAIL_EXPEDITEUR },
    replyTo: { name: NOM_EXPEDITEUR, email: EMAIL_REPONSE },
    to: [{ email: envoi.destinataire }],
    subject: m.sujet, htmlContent: m.html, textContent: m.texte,
    tags: ["reservation", envoi.type],
  };
  if (m.pieces) corps.attachment = m.pieces;
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify(corps),
  });
  if (!res.ok) throw new Error("Brevo " + res.status + " " + (await res.text()).slice(0, 200));
}

async function traiterEnvois(limite = 20) {
  if (!process.env.BREVO_API_KEY) return { envoyes: 0, attente: "BREVO_API_KEY absente" };
  const lot = await rpc("envois_a_traiter", { p_limite: limite });
  let envoyes = 0, erreurs = 0;
  for (const e of lot || []) {
    try { await envoyerEmail(e); await rpc("envoi_resultat", { p_id: e.id, p_ok: true }); envoyes++; }
    catch (err) { erreurs++; await rpc("envoi_resultat", { p_id: e.id, p_ok: false, p_erreur: err.message }).catch(() => {}); }
  }
  return { envoyes, erreurs };
}

async function traiterRemboursements(limite = 20) {
  const lot = await rpc("remboursements_a_traiter", { p_limite: limite });
  let faits = 0, erreurs = 0;
  for (const r of lot || []) {
    const rep = await stripePost("refunds", {
      payment_intent: r.stripe_payment_intent, amount: String(r.montant_centimes),
      "metadata[remboursement_id]": r.id, "metadata[motif]": r.motif,
    }, "remb-" + r.id).catch((e) => ({ ok: false, data: { error: { message: e.message } } }));
    const deja = !rep.ok && rep.data && rep.data.error && rep.data.error.code === "charge_already_refunded";
    if (rep.ok || deja) {
      await rpc("remboursement_resultat", { p_id: r.id, p_ok: true, p_stripe_refund_id: rep.ok ? rep.data.id : null }); faits++;
    } else {
      await rpc("remboursement_resultat", { p_id: r.id, p_ok: false, p_erreur: (rep.data.error && rep.data.error.message) || "Stripe" }); erreurs++;
    }
  }
  return { faits, erreurs };
}

/** Frais d'annulation tardive ou d'absence : prélevés sur la carte gardée.
    Si la banque demande une validation (ou refuse), un lien de paiement est envoyé. */
async function traiterFrais(limite = 20) {
  const lot = await rpc("frais_a_traiter", { p_limite: limite });
  let preleves = 0, liens = 0, erreurs = 0;
  for (const f of lot || []) {
    try {
      let rep = { ok: false, data: { error: { code: "pas_de_carte" } } };
      if (f.stripe_customer && f.stripe_payment_method) {
        rep = await stripePost("payment_intents", {
          amount: String(f.montant_centimes), currency: "eur",
          customer: f.stripe_customer, payment_method: f.stripe_payment_method,
          off_session: "true", confirm: "true",
          description: "Frais d'annulation tardive ou d'absence, réservation " + f.reference,
          "metadata[frais_reservation_id]": f.id, receipt_email: f.email,
        }, "frais-" + f.id);
      }
      if (rep.ok && rep.data.status === "succeeded") {
        await rpc("frais_resultat", { p_reservation_id: f.id, p_resultat: "preleve", p_payment_intent: rep.data.id }); preleves++;
        continue;
      }
      const code = (rep.data && rep.data.error && (rep.data.error.code || rep.data.error.decline_code)) || (rep.data && rep.data.status) || "";
      const aPayerParLaPersonne = /authentication_required|card_declined|requires_action|requires_payment_method|expired_card|insufficient_funds|pas_de_carte/.test(code);
      if (!aPayerParLaPersonne) {
        await rpc("frais_resultat", { p_reservation_id: f.id, p_resultat: "reessayer", p_erreur: code || "Stripe" }); erreurs++;
        continue;
      }
      // Lien de paiement valable 24 h, envoyé par email.
      const s = await stripePost("checkout/sessions", {
        mode: "payment",
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][unit_amount]": String(f.montant_centimes),
        "line_items[0][price_data][product_data][name]": "Frais d'annulation tardive, réservation " + f.reference,
        ...(f.stripe_customer ? { customer: f.stripe_customer } : { customer_email: f.email }),
        "metadata[frais_reservation_id]": f.id,
        "payment_intent_data[metadata][frais_reservation_id]": f.id,
        expires_at: String(Math.floor(Date.now() / 1000) + 23 * 3600),
        success_url: SITE_URL + "/", cancel_url: SITE_URL + "/",
      }, "frais-lien-" + f.id);
      if (!s.ok) throw new Error((s.data.error && s.data.error.message) || "Stripe");
      await rpc("frais_resultat", { p_reservation_id: f.id, p_resultat: "a_payer", p_lien: s.data.url }); liens++;
    } catch (err) {
      erreurs++;
      await rpc("frais_resultat", { p_reservation_id: f.id, p_resultat: "reessayer", p_erreur: err.message }).catch(() => {});
    }
  }
  return { preleves, liens, erreurs };
}

/** Cartes enregistrées à retirer de Stripe (CGV art. 10.4). */
async function traiterCartes(limite = 20) {
  const lot = await rpc("cartes_a_retirer", { p_limite: limite });
  let retirees = 0, erreurs = 0;
  for (const c of lot || []) {
    const rep = await stripePost("payment_methods/" + encodeURIComponent(c.stripe_payment_method) + "/detach", {}, "detach-" + c.id)
      .catch((e) => ({ ok: false, data: { error: { message: e.message } } }));
    const err = (rep.data && rep.data.error) || {};
    const dejaRetiree = !rep.ok && (err.code === "resource_missing" || /not attached|does not have/i.test(err.message || ""));
    if (rep.ok || dejaRetiree) { await rpc("carte_retiree", { p_reservation_id: c.id }); retirees++; }
    else { erreurs++; console.error("carte non retirée", c.id, err.message); }
  }
  return { retirees, erreurs };
}

/** Tout ce qui est en attente (appelé par la tâche planifiée, et juste après
    une action pour ne pas faire attendre les emails). */
async function toutTraiter() {
  const bilan = {};
  for (const [nom, f] of [["remboursements", traiterRemboursements], ["frais", traiterFrais],
                          ["cartes", traiterCartes], ["emails", traiterEnvois]]) {
    try { bilan[nom] = await f(); } catch (e) { bilan[nom] = { erreur: e.message }; console.error("toutTraiter", nom, e.message); }
  }
  return bilan;
}

module.exports = { confirmerSession, traiterEnvois, traiterRemboursements, traiterFrais, traiterCartes, toutTraiter, envoyerEmail };
