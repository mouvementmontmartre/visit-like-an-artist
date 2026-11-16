/* ============================================================
   FONCTION NETLIFY — restore-access
   Retrouve un achat "parcours complet" déjà payé, à partir de
   l'email utilisé au paiement, pour redébloquer l'accès sur un
   nouvel appareil (ou après que le stockage local a été vidé).

   Fonctionne via l'API de recherche Stripe sur les PaymentIntents,
   en filtrant sur les métadonnées posées par create-checkout.js
   (visite + restore_email). Aucune base de données nécessaire :
   Stripe sert de source de vérité.
   ============================================================ */

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "POST attendu" }) };
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: "Paiement non configuré." }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Corps invalide" }) }; }

  const visite = String(payload.visite || "").trim();
  const email = String(payload.email || "").trim().toLowerCase();
  if (!visite || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Paramètres invalides" }) };
  }

  // Échappement minimal : évite de casser la syntaxe de requête Stripe.
  const esc = (s) => s.replace(/['\\]/g, "");
  const query =
    "status:'succeeded' AND metadata['visite']:'" + esc(visite) + "' AND metadata['restore_email']:'" + esc(email) + "'";

  let res, data;
  try {
    res = await fetch(
      "https://api.stripe.com/v1/payment_intents/search?query=" + encodeURIComponent(query),
      { headers: { "Authorization": "Bearer " + key } }
    );
    data = await res.json();
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Stripe injoignable" }) };
  }

  if (!res.ok) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: data.error?.message || "Erreur Stripe" }) };
  }

  const restored = Array.isArray(data.data) && data.data.length > 0;
  return { statusCode: 200, headers, body: JSON.stringify({ restored }) };
};
