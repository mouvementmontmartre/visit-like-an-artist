/* ============================================================
   FONCTION NETLIFY — stripe-webhook
   Stripe appelle cette adresse à chaque évènement de paiement.
   Aujourd'hui : adhésions (cartes de membre). Ensuite (étape 5) :
   réservations.

   Sécurité :
   - la signature Stripe est vérifiée (STRIPE_WEBHOOK_SECRET) : un
     appel qui ne vient pas de Stripe est refusé ;
   - chaque évènement n'est traité qu'une fois (table
     webhook_evenements) ; en cas d'erreur, réponse 500 pour que
     Stripe réessaie plus tard ;
   - les objets sont relus auprès de Stripe avant d'être enregistrés.

   Évènements à cocher dans Stripe (Développeurs > Webhooks) :
   checkout.session.completed, checkout.session.async_payment_succeeded,
   invoice.paid, customer.subscription.updated,
   customer.subscription.deleted, charge.refunded
   ============================================================ */

const {
  json, table, rpc, stripe, signatureStripeValide, idDe,
  enregistrerAbonnement, enregistrerSession, formuleAbonnement,
} = require("../lib/commun");

async function traiter(evt) {
  const obj = evt.data && evt.data.object;
  switch (evt.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded": {
      const session = await stripe("checkout/sessions/" + obj.id, { "expand[]": "line_items.data.price" });
      await enregistrerSession(session);
      return;
    }
    case "invoice.paid": {
      const subId = obj.subscription
        || (obj.parent && obj.parent.subscription_details && obj.parent.subscription_details.subscription);
      if (!subId) return;
      const sub = await stripe("subscriptions/" + idDe(subId), { "expand[]": "customer" });
      if (formuleAbonnement(sub)) await enregistrerAbonnement(sub);
      return;
    }
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      if (!formuleAbonnement(obj)) return;
      const sub = await stripe("subscriptions/" + obj.id, { "expand[]": "customer" });
      await enregistrerAbonnement(sub);
      return;
    }
    case "charge.refunded": {
      if (obj.refunded && obj.payment_intent) await rpc("adhesion_remboursee", { p_payment_intent: idDe(obj.payment_intent) });
      return;
    }
    default:
      return; // évènement non utilisé
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST attendu" });

  const corps = event.isBase64Encoded ? Buffer.from(event.body || "", "base64").toString("utf8") : (event.body || "");
  const signature = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  if (!signatureStripeValide(corps, signature, process.env.STRIPE_WEBHOOK_SECRET)) {
    return json(400, { error: "Signature invalide" });
  }

  let evt;
  try { evt = JSON.parse(corps); } catch (e) { return json(400, { error: "Corps invalide" }); }
  if (!evt || !/^evt_[A-Za-z0-9]+$/.test(evt.id || "")) return json(400, { error: "Évènement invalide" });

  try {
    // Déjà traité ? (Stripe renvoie parfois le même évènement)
    await table("POST", "webhook_evenements?on_conflict=stripe_event_id",
      { stripe_event_id: evt.id, type: String(evt.type || "").slice(0, 100) },
      { Prefer: "resolution=ignore-duplicates,return=minimal" });
    const lignes = await table("GET", "webhook_evenements?select=traite_le&stripe_event_id=eq." + encodeURIComponent(evt.id));
    if (lignes && lignes[0] && lignes[0].traite_le) return json(200, { recu: true, deja_traite: true });

    await traiter(evt);

    await table("PATCH", "webhook_evenements?stripe_event_id=eq." + encodeURIComponent(evt.id),
      { traite_le: new Date().toISOString() }, { Prefer: "return=minimal" });
    return json(200, { recu: true });
  } catch (e) {
    console.error("stripe-webhook", evt.type, evt.id, e.message);
    return json(500, { error: "Traitement impossible, Stripe réessaiera." });
  }
};
