/* ============================================================
   FONCTION NETLIFY — create-checkout
   Crée une session de paiement Stripe Checkout pour une visite.

   Sécurité :
   - La clé secrète Stripe vient d'une variable d'environnement
     Netlify (STRIPE_SECRET_KEY), jamais du code source.
   - Le prix de la visite guidée est relu ici, côté serveur,
     depuis la Google Sheet Visites : le client ne peut pas
     envoyer un prix trafiqué.
   - Le montant "prix libre" est validé ici (minimum 5 €).

   Aucune dépendance npm : appels directs à l'API Stripe via
   fetch (disponible nativement dans les fonctions Netlify).
   ============================================================ */

const VISITES_CSV = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAdB0d0AOIKZvP61bZAOWGkxanyb0DyUL0tXzl0gTMqcKQncf8svdhwh7cyOOKH52PzQ7qgR-DKsv_/pub?gid=0&single=true&output=csv";
const MIN_LIBRE_CENTS = 500; // 5 €

/* Mini-parseur CSV (guillemets, virgules internes) */
function parseCSV(text) {
  const rows = []; let row = [], field = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i+1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else {
      if (c === '"') q = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i+1] === "\n") i++;
        row.push(field); field = ""; rows.push(row); row = [];
      } else field += c;
    }
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const head = rows[0].map(h => h.trim());
  return rows.slice(1)
    .filter(r => r.some(c => c.trim() !== ""))
    .map(r => Object.fromEntries(head.map((h, i) => [h, (r[i] || "").trim()])));
}

/* "50€" / "50 €" / "50,00" → centimes */
function parsePriceCents(s) {
  const m = String(s || "").replace(",", ".").match(/(\d+(?:\.\d+)?)/);
  return m ? Math.round(parseFloat(m[1]) * 100) : null;
}

exports.handler = async (event) => {
  const headers = { "Content-Type": "application/json" };

  if (event.httpMethod !== "POST") {
    return { statusCode: 405, headers, body: JSON.stringify({ error: "POST attendu" }) };
  }

  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: "Paiement non configuré (clé Stripe absente)." }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch (e) { return { statusCode: 400, headers, body: JSON.stringify({ error: "Corps invalide" }) }; }

  const { visite, mode, montant, email } = payload; // mode : "guide" | "libre" ; montant en € (libre uniquement)
  if (!visite || !["guide", "libre"].includes(mode)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Paramètres manquants" }) };
  }
  const cleanEmail = String(email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: "Email invalide" }) };
  }

  // Relire la visite côté serveur (nom + prix de référence)
  let v;
  try {
    const csv = await (await fetch(VISITES_CSV)).text();
    v = parseCSV(csv).find(r => r["id"] === visite && (r["Actif"] || "").toLowerCase() === "oui");
  } catch (e) { /* la Sheet peut être injoignable : on refuse proprement */ }
  if (!v) {
    return { statusCode: 404, headers, body: JSON.stringify({ error: "Visite introuvable" }) };
  }

  let unitAmount, label;
  if (mode === "guide") {
    unitAmount = parsePriceCents(v["Tarif direct"]);
    if (!unitAmount) return { statusCode: 400, headers, body: JSON.stringify({ error: "Tarif de la visite non défini" }) };
    label = v["Nom"] + " — visite guidée";
  } else {
    unitAmount = Math.round(parseFloat(montant) * 100);
    if (!isFinite(unitAmount) || unitAmount < MIN_LIBRE_CENTS) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: "Montant minimum : 5 €" }) };
    }
    label = v["Nom"] + " — accès autoguide";
  }

  // URL de retour : la page d'origine de l'app
  const origin = (event.headers["origin"] || event.headers["Origin"] || "").replace(/\/$/, "")
    || "https://" + (event.headers["host"] || "");

  const params = new URLSearchParams({
    "mode": "payment",
    "line_items[0][quantity]": "1",
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": String(unitAmount),
    "line_items[0][price_data][product_data][name]": label,
    "customer_email": cleanEmail,
    "metadata[visite]": visite,
    "metadata[restore_email]": cleanEmail,
    "payment_intent_data[metadata][visite]": visite,
    "payment_intent_data[metadata][restore_email]": cleanEmail,
    "payment_intent_data[receipt_email]": cleanEmail,
    "success_url": origin + "/?session_id={CHECKOUT_SESSION_ID}&visite=" + encodeURIComponent(visite),
    "cancel_url": origin + "/",
  });

  let res, session;
  try {
    res = await fetch("https://api.stripe.com/v1/checkout/sessions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + key,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: params.toString(),
    });
    session = await res.json();
  } catch (e) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: "Stripe injoignable : " + (e.message || e) }) };
  }

  if (!res.ok) {
    return { statusCode: 502, headers, body: JSON.stringify({ error: session.error?.message || "Erreur Stripe" }) };
  }
  return { statusCode: 200, headers, body: JSON.stringify({ url: session.url }) };
};
