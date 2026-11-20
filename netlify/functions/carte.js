/* ============================================================
   FONCTION NETLIFY — carte (carte de membre)
   Toujours en POST, corps JSON { action, … } :

   - "voir"    { jeton }       → la carte liée à ce jeton
   - "session" { session_id }  → au retour du paiement d'adhésion :
                                 vérifie le paiement auprès de Stripe,
                                 enregistre l'adhésion, crée un jeton
   - "email"   { email, langue } → envoie un code à 6 chiffres (15 min) à
                                 l'adresse, si elle a une adhésion ; réponse
                                 toujours identique (21/11 : seul l'adhérent
                                 peut afficher sa carte)
   - "code"    { email, code }  → code bon : la carte et son jeton (ce
                                 téléphone) si l'adresse est adhérente, et la
                                 session de l'espace si elle a un compte
                                 d'intervenant ou d'association (22/11 :
                                 connexion unique par code pour tout le monde)
   - "connexion" { jeton }     → lien de connexion d'un email (7 jours, une
                                 fois) : même réponse que « code »
   - "reservations" { jeton }  → Mon compte (E15.2) : expériences réservées à
                                 venir de l'adresse de la carte
   - "ouvrir"  { jeton, reservation_id } → lien personnel d'une réservation
                                 (« Voir »)
   - "lien"    { email, langue } → envoie par email un lien vers la
                                 carte (si l'adresse est adhérente)
   - "adherer" { nom, email, telephone, langue, accord_adhesion } (E15)
                               → paiement de l'adhésion (abonnement 5 €/an)
   - "portail" { jeton }       → « Gérer mon abonnement » : portail client
                                 Stripe (résiliation, carte)

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

const crypto = require("crypto");
const {
  SITE_URL, envoyerBrevo, EMAIL_EXPEDITEUR, NOM_EXPEDITEUR, EMAIL_REPONSE,
  json, sha256hex, nouveauJeton, jetonValide, emailValide,
  rpc, table, stripe, stripePost, enregistrerSession, sessionAdhesion, sessionPour,
} = require("../lib/commun");

/** Adresse prouvée (code ou lien d'email) : carte si adhérente, session de l'espace si elle a un compte. */
async function connecte(email, jetonDeja) {
  const jeton = jetonDeja || nouveauJeton();
  const carte = await carteSiAdherent(email, jeton);
  const compte = await rpc("compte_par_email", { p_email: email });
  let session = null;
  if (compte && compte.role) {
    try { session = await sessionPour(email); } catch (e) { console.error("carte session espace", e.message); }
  }
  if (!carte && !session) return json(404, { error: "Aucune adhésion", code: "AUCUNE" });
  return json(200, Object.assign({ email, role: compte ? compte.role : null, session },
    carte ? { jeton, carte } : {}));
}

/** Lien de carte pour une adresse adhérente (déjà créé par la vérification du code, sinon ici). */
async function carteSiAdherent(email, jeton) {
  let carte = await rpc("carte_par_jeton", { p_jeton_hash: sha256hex(jeton) });
  if (!carte) {
    const etat = await rpc("carte_creer_lien", { p_email: email, p_jeton_hash: sha256hex(jeton), p_origine: "code" }).catch(() => null);
    if (etat === "cree") carte = await rpc("carte_par_jeton", { p_jeton_hash: sha256hex(jeton) });
  }
  return carte || null;
}

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

/** Email du code de vérification (FR, EN, ES). */
async function envoyerCode(email, code, langue) {
  const tx = {
    fr: { sujet: "Votre code ArtDive : " + code, intro: "Voici votre code pour vous connecter à ArtDive (Mon compte, carte de membre, espace intervenants) :",
          fin: "Il est valable 15 minutes. Si vous n'avez rien demandé, ignorez cet email : personne ne peut se connecter à votre compte sans ce code." },
    en: { sujet: "Your ArtDive code: " + code, intro: "Here is your code to sign in to ArtDive (My account, member card, hosts' area):",
          fin: "It is valid for 15 minutes. If you did not ask for it, ignore this email: nobody can sign in to your account without this code." },
    es: { sujet: "Tu código ArtDive: " + code, intro: "Este es tu código para conectarte a ArtDive (Mi cuenta, tarjeta de socio, espacio de anfitriones):",
          fin: "Es válido 15 minutos. Si no lo has pedido, ignora este email: nadie puede conectarse a tu cuenta sin este código." },
  }[["fr", "en", "es"].includes(langue) ? langue : "fr"];
  const html = '<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#14100E;max-width:480px">' +
    "<p>" + tx.intro + '</p><p style="font-size:32px;letter-spacing:.2em;font-weight:bold">' + code + '</p><p style="font-size:13px;color:#5A4E44">' +
    tx.fin + "</p><p>" + NOM_EXPEDITEUR + "</p></div>";
  await envoyerBrevo(email, { sujet: tx.sujet, html, texte: tx.intro + "\n\n" + code + "\n\n" + tx.fin }, ["carte-code"]);
}

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
      // L'email (vérifié : le jeton ne s'obtient qu'avec le code ou le paiement) sert à réserver en adhérent sur ce téléphone.
      const email = carte ? await rpc("carte_email", { p_jeton_hash: sha256hex(p.jeton) }).catch(() => null) : null;
      return carte ? json(200, { carte, email }) : json(404, { error: "Carte introuvable" });
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
      return json(200, { jeton, carte, email: r.email });
    }

    // Code de vérification (21/11) : seul l'adhérent, qui reçoit le code, peut afficher sa carte.
    // Même réponse que l'adresse soit adhérente ou non, ou que la limite (3 codes par heure) soit atteinte.
    if (p.action === "email") {
      if (!process.env.BREVO_API_KEY) return json(503, { error: "Envoi des emails pas encore configuré." });
      const email = String(p.email || "").trim().toLowerCase();
      if (!emailValide(email)) return json(400, { error: "Email invalide" });
      const code = String(crypto.randomInt(0, 1000000)).padStart(6, "0");
      const etat = await rpc("carte_code_creer", { p_email: email, p_code_hash: sha256hex(email + ":" + code) });
      if (etat === "cree") await envoyerCode(email, code, p.langue);
      else await new Promise((r) => setTimeout(r, 250 + Math.floor(Math.random() * 400)));
      return json(200, { ok: true });
    }

    if (p.action === "code") {
      const email = String(p.email || "").trim().toLowerCase(), code = String(p.code || "").replace(/\s/g, "");
      if (!emailValide(email) || !/^\d{6}$/.test(code)) return json(400, { error: "CODE_INVALIDE", code: "INVALIDE" });
      const jetonVerif = nouveauJeton();
      const etat = await rpc("carte_code_verifier", { p_email: email, p_code_hash: sha256hex(email + ":" + code), p_jeton_hash: sha256hex(jetonVerif) });
      if (etat !== "ok") return json(etat === "invalide" ? 400 : etat === "trop_essais" ? 429 : 410, { error: etat, code: String(etat).toUpperCase() });
      return connecte(email, jetonVerif);   // lien de carte déjà créé si l'adresse est adhérente
    }

    // Lien de connexion directe des emails aux intervenants (accès, expérience validée).
    if (p.action === "connexion") {
      if (!jetonValide(p.jeton)) return json(400, { error: "Lien invalide", code: "EXPIRE" });
      const r = await rpc("connexion_lien_utiliser", { p_jeton_hash: sha256hex(p.jeton) });
      if (!r || r.etat !== "ok") return json(410, { error: "Lien expiré", code: r && r.etat === "utilise" ? "UTILISE" : "EXPIRE" });
      return connecte(r.email);
    }

    // Mon compte (E15.2) : réservations à venir de l'adresse vérifiée par la carte de ce téléphone.
    if (p.action === "reservations") {
      if (!jetonValide(p.jeton)) return json(400, { error: "Lien invalide" });
      const liste = await rpc("reservations_a_venir", { p_jeton_hash: sha256hex(p.jeton) });
      return json(200, { reservations: liste || [] });
    }

    if (p.action === "ouvrir") {
      if (!jetonValide(p.jeton) || !/^[0-9a-f-]{36}$/.test(String(p.reservation_id || ""))) return json(400, { error: "Lien invalide" });
      const jeton = await rpc("lien_reservation_compte", { p_jeton_hash: sha256hex(p.jeton), p_reservation_id: p.reservation_id });
      return jeton ? json(200, { jeton }) : json(404, { error: "Réservation introuvable" });
    }

    if (p.action === "adherer") {
      const email = String(p.email || "").trim().toLowerCase(), nom = String(p.nom || "").trim().slice(0, 120);
      if (!emailValide(email) || !nom) return json(400, { error: "PARAMETRES", code: "PARAMETRES" });
      if (p.accord_adhesion !== true) return json(400, { error: "ACCORD_ADHESION", code: "ACCORD_ADHESION" });
      const deja = await rpc("adhesion_pour_reservation", { p_email: email });
      if (deja && deja.adherent) return json(409, { error: "DEJA_ADHERENT", code: "DEJA_ADHERENT" });
      const s = await sessionAdhesion({ email, nom, telephone: String(p.telephone || "").trim(), langue: p.langue });
      if (!s.ok) { console.error("carte adherer", s.data && s.data.error && s.data.error.message); return json(502, { error: "STRIPE", code: "STRIPE" }); }
      return json(200, { url: s.data.url });
    }

    if (p.action === "portail") {
      if (!jetonValide(p.jeton)) return json(400, { error: "Lien invalide" });
      const l = (await table("GET", "cartes_liens?select=email&revoque_le=is.null&jeton_hash=eq." + sha256hex(p.jeton)))[0];
      if (!l) return json(404, { error: "Carte introuvable" });
      const c = await rpc("adhesion_carte", { p_email: l.email });
      if (!c || !c.stripe_customer) return json(404, { error: "SANS_ABONNEMENT", code: "SANS_ABONNEMENT" });
      const s = await stripePost("billing_portal/sessions", { customer: c.stripe_customer, return_url: SITE_URL + "/#membre" });
      if (!s.ok) { console.error("carte portail", s.data && s.data.error && s.data.error.message); return json(502, { error: "STRIPE", code: "STRIPE" }); }
      return json(200, { url: s.data.url });
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
