/* ============================================================
   FONCTION NETLIFY — carte (carte de membre)
   Toujours en POST, corps JSON { action, … } :

   - "voir"    { jeton }       → la carte liée à ce jeton
   - "session" { session_id }  → au retour du paiement d'adhésion :
                                 vérifie le paiement auprès de Stripe,
                                 enregistre l'adhésion, crée un jeton
   - "lien"    { email, langue } → envoie par email un lien vers la
                                 carte (si l'adresse est adhérente)

   Sécurité :
   - la liste des adhérents ne sort jamais de la base ; on ne renvoie
     que la carte du jeton présenté ;
   - « lien » répond toujours la même chose, que l'adresse soit
     adhérente ou non (impossible de tester des emails) ; 3 envois par
     heure au plus pour une même adresse ;
   - le lien envoyé pointe toujours vers SITE_URL, jamais vers
     l'adresse d'où vient la demande ;
   - le jeton voyage après un « # » : il n'est jamais envoyé à un serveur
     ni écrit dans les journaux.
   ============================================================ */

const {
  SITE_URL, EMAIL_EXPEDITEUR, NOM_EXPEDITEUR, EMAIL_REPONSE,
  json, sha256hex, nouveauJeton, jetonValide, emailValide,
  rpc, stripe, enregistrerSession,
} = require("../lib/commun");

const TEXTES = {
  fr: {
    sujet: "Votre carte de membre du Mouvement Montmartre",
    bonjour: "Bonjour,",
    corps: "Voici le lien vers votre carte de membre. Ouvrez-le sur votre téléphone : la carte s'enregistre dans l'application.",
    bouton: "Ouvrir ma carte",
    fin: "Si vous n'avez pas demandé ce lien, ignorez simplement cet email.",
  },
  en: {
    sujet: "Your Mouvement Montmartre member card",
    bonjour: "Hello,",
    corps: "Here is the link to your member card. Open it on your phone: the card is saved in the app.",
    bouton: "Open my card",
    fin: "If you did not ask for this link, simply ignore this email.",
  },
  es: {
    sujet: "Tu tarjeta de miembro del Mouvement Montmartre",
    bonjour: "Hola,",
    corps: "Este es el enlace a tu tarjeta de miembro. Ábrelo en tu teléfono: la tarjeta se guarda en la aplicación.",
    bouton: "Abrir mi tarjeta",
    fin: "Si no has pedido este enlace, ignora este email.",
  },
};

async function envoyerEmail(email, lien, langue) {
  const tx = TEXTES[langue] || TEXTES.fr;
  const html =
    '<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#14100E;max-width:480px">' +
    "<p>" + tx.bonjour + "</p><p>" + tx.corps + "</p>" +
    '<p><a href="' + lien + '" style="display:inline-block;padding:12px 22px;border-radius:999px;' +
    'background:#14100E;color:#EFE8D8;text-decoration:none">' + tx.bouton + "</a></p>" +
    '<p style="font-size:13px;color:#5A4E44">' + tx.fin + "</p>" +
    "<p>" + NOM_EXPEDITEUR + "</p></div>";
  const texte = tx.bonjour + "\n\n" + tx.corps + "\n\n" + lien + "\n\n" + tx.fin + "\n\n" + NOM_EXPEDITEUR;

  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": process.env.BREVO_API_KEY, "Content-Type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender: { name: NOM_EXPEDITEUR, email: EMAIL_EXPEDITEUR },
      replyTo: { name: NOM_EXPEDITEUR, email: EMAIL_REPONSE },
      to: [{ email }],
      subject: tx.sujet,
      htmlContent: html,
      textContent: texte,
      tags: ["carte-membre"],
    }),
  });
  if (!res.ok) throw new Error("Brevo " + res.status + " " + (await res.text()).slice(0, 200));
}

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST attendu" });
  let p;
  try { p = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Corps invalide" }); }

  try {
    if (p.action === "voir") {
      if (!jetonValide(p.jeton)) return json(400, { error: "Lien invalide" });
      const carte = await rpc("carte_par_jeton", { p_jeton_hash: sha256hex(p.jeton) });
      return carte ? json(200, { carte }) : json(404, { error: "Carte introuvable" });
    }

    if (p.action === "session") {
      const id = String(p.session_id || "");
      if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(id)) return json(400, { error: "Session invalide" });
      const session = await stripe("checkout/sessions/" + id, { "expand[]": "line_items.data.price" });
      // Un retour de paiement ne sert qu'à l'acheteur, et seulement dans les 24 h.
      if (session.status !== "complete" || Date.now() / 1000 - session.created > 24 * 3600) {
        return json(400, { error: "Session expirée" });
      }
      const r = await enregistrerSession(session);   // sans attendre le webhook (même résultat, sans doublon)
      if (!r) return json(400, { error: "Ce paiement n'est pas une adhésion" });
      const jeton = nouveauJeton();
      const etat = await rpc("carte_creer_lien", { p_email: r.email, p_jeton_hash: sha256hex(jeton), p_origine: "paiement" });
      if (etat !== "cree") return json(400, { error: "Carte indisponible" });
      const carte = await rpc("carte_par_jeton", { p_jeton_hash: sha256hex(jeton) });
      return json(200, { jeton, carte });
    }

    // Carte affichée directement à partir de l'email (décision du 19/11 : plus de lien par email).
    // Limite : 3 essais par adresse et par heure (carte_creer_lien).
    if (p.action === "email") {
      const email = String(p.email || "").trim().toLowerCase();
      if (!emailValide(email)) return json(400, { error: "Email invalide" });
      const jeton = nouveauJeton();
      const etat = await rpc("carte_creer_lien", { p_email: email, p_jeton_hash: sha256hex(jeton), p_origine: "email" });
      if (etat === "trop_de_demandes") return json(429, { error: "Trop de demandes" });
      if (etat !== "cree") return json(404, { error: "Aucune adhésion" });
      const carte = await rpc("carte_par_jeton", { p_jeton_hash: sha256hex(jeton) });
      return carte ? json(200, { jeton, carte }) : json(404, { error: "Aucune adhésion" });
    }

    if (p.action === "lien") {
      if (!process.env.BREVO_API_KEY) return json(503, { error: "Envoi des emails pas encore configuré." });
      const email = String(p.email || "").trim().toLowerCase();
      if (!emailValide(email)) return json(400, { error: "Email invalide" });
      const langue = ["fr", "en", "es"].includes(p.langue) ? p.langue : "fr";
      const jeton = nouveauJeton();
      const etat = await rpc("carte_creer_lien", { p_email: email, p_jeton_hash: sha256hex(jeton), p_origine: "email" });
      if (etat === "cree") await envoyerEmail(email, SITE_URL + "/#carte=" + jeton, langue);
      // Sinon, même durée à peu près qu'un envoi : on ne peut pas deviner qui est adhérent en chronométrant.
      else await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 400)));
      // Même réponse dans tous les cas.
      return json(200, { ok: true });
    }

    return json(400, { error: "Action inconnue" });
  } catch (e) {
    console.error("carte", p && p.action, e.message);
    return json(500, { error: "Service momentanément indisponible" });
  }
};
