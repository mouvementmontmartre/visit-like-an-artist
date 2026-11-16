/* ============================================================
   FONCTION NETLIFY — verify-session
   Vérifie auprès de Stripe qu'une session Checkout correspond
   bien à un paiement réel et complet, avant que l'app ne
   débloque quoi que ce soit.

   Pourquoi c'est indispensable : sans cette vérification,
   n'importe qui pourrait taper l'URL de retour à la main
   (?session_id=nimportequoi) et accéder gratuitement.
   ============================================================ */

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: "Paiement non configuré." }) };
  }

  const sessionId = (event.queryStringParameters || {}).session_id;
  if (!sessionId || !/^cs_[A-Za-z0-9_]+$/.test(sessionId)) {
    return { statusCode: 400, headers, body: JSON.stringify({ paid: false }) };
  }

  const res = await fetch(
    "https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(sessionId),
    { headers: { "Authorization": "Bearer " + key } }
  );
  const session = await res.json();

  const paid = res.ok && session.payment_status === "paid";
  return {
    statusCode: 200,
    headers,
    body: JSON.stringify({
      paid,
      visite: paid ? (session.metadata && session.metadata.visite) || null : null,
    }),
  };
};
