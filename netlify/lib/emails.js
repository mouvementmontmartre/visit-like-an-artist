/* ============================================================
   EMAILS DES RÉSERVATIONS
   La base met en file un type d'email et ses données (table
   « envois ») ; ce module en fait un email (sujet, HTML, texte,
   pièce jointe calendrier) dans la langue du destinataire.
   Les alertes (association, guide ou artiste) sont en français.
   Tout texte venant de la base est échappé.
   ============================================================ */

const { SITE_URL } = require("./commun");

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const LOCALES = { fr: "fr-FR", en: "en-GB", es: "es-ES" };
const euros = (c, l) => new Intl.NumberFormat(LOCALES[l] || "fr-FR", { style: "currency", currency: "EUR",
  minimumFractionDigits: c % 100 ? 2 : 0 }).format((c || 0) / 100);
const quand = (iso, l) => new Intl.DateTimeFormat(LOCALES[l] || "fr-FR", { timeZone: "Europe/Paris",
  weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
const titre = (d, l) => (d.titre && (d.titre[l] || d.titre.fr)) || "";
const estVisite = (d) => d.type === "visite_guidee" || d.type === "atelier";

const T = {
  fr: {
    bonjour: (n) => "Bonjour " + n + ",",
    confirmation_sujet: (d) => "Votre place est réservée : " + d,
    confirmation_intro: "Votre réservation est confirmée. Voici l'essentiel.",
    rappel_sujet: (d) => "C'est bientôt : " + d,
    rappel_intro: "Petit rappel : votre visite approche. Voici l'essentiel.",
    date: "Date", personnes: "Personnes", avec: "Avec", rdv: "Rendez-vous", ref: "Référence",
    paye: "Payé en ligne", reste: (m, g) => "Le reste, " + m + ", se règle " + (g ? "à " + g + " " : "") + "sur place. Pensez à prendre de la monnaie.",
    mot: "Le mot de votre hôte",
    regle: (f) => "Vous ne pouvez plus venir ? Prévenez-nous avec le bouton ci-dessous : la place sera proposée à quelqu'un d'autre. La pré-réservation reste acquise. Moins de 24 h avant, ou en cas d'absence sans prévenir, " + f + " de frais par personne sont prélevés sur la carte utilisée.",
    regle_soiree: "Vous ne pouvez plus venir ? Prévenez-nous avec le bouton ci-dessous.",
    bouton_annuler: "Je ne peux plus venir",
    calendrier: "Le fichier joint ajoute la visite à votre calendrier.",
    cgv: "Cette activité de loisirs a lieu à une date déterminée : elle n'ouvre pas de droit de rétractation (article L221-28, 12° du Code de la consommation). Vos conditions générales de vente :",
    lien_cgv: "lire les CGV",
    annulation_sujet: (d) => "Annulation enregistrée : " + d,
    annulation_texte: "Votre annulation est enregistrée et votre place a été libérée.",
    annulation_frais: (m) => "L'annulation intervenant moins de 24 h avant, " + m + " de frais d'annulation tardive vont être prélevés sur la carte utilisée lors de la réservation.",
    annulation_sans_frais: "La pré-réservation reste acquise, aucun autre frais n'est appliqué.",
    seance_annulee_sujet: (d) => "Séance annulée : " + d,
    seance_annulee_minimum: "Le nombre minimum de participants n'a pas été atteint : la séance est annulée.",
    seance_annulee_orga: "Nous sommes désolés : la séance est annulée par l'organisation.",
    rembourse: (m) => "Vous êtes remboursé intégralement de " + m + ". Le remboursement apparaît sur votre compte sous 5 à 10 jours.",
    tardif_sujet: (d) => "Réservation impossible, vous êtes remboursé : " + d,
    tardif_texte: "Votre paiement est arrivé après la fin du délai de réservation, et la dernière place a été prise entre-temps.",
    frais_sujet: "Frais d'annulation tardive",
    frais_texte: (m) => m + " de frais d'annulation tardive ou d'absence ont été prélevés sur votre carte, conformément aux conditions acceptées lors de la réservation.",
    frais_payer_sujet: "Frais d'annulation tardive à régler",
    frais_payer_texte: (m) => "Votre banque demande une validation pour le prélèvement de " + m + " de frais d'annulation tardive ou d'absence. Merci de le régler avec le bouton ci-dessous.",
    bouton_payer: "Régler les frais",
    fin: "À bientôt sur la Butte,",
    signature: "Mouvement Montmartre",
  },
  en: {
    bonjour: (n) => "Hello " + n + ",",
    confirmation_sujet: (d) => "Your spot is booked: " + d,
    confirmation_intro: "Your booking is confirmed. Here is what you need to know.",
    rappel_sujet: (d) => "Coming up soon: " + d,
    rappel_intro: "A quick reminder: your tour is coming up. Here is what you need to know.",
    date: "Date", personnes: "People", avec: "With", rdv: "Meeting point", ref: "Reference",
    paye: "Paid online", reste: (m, g) => "The rest, " + m + ", is paid on site" + (g ? " to " + g : "") + ". Please bring cash.",
    mot: "A word from your host",
    regle: (f) => "Can't make it? Let us know with the button below so the spot can go to someone else. The booking fee is non refundable. Less than 24 hours before, or if you do not show up, a " + f + " fee per person is charged to the card you used.",
    regle_soiree: "Can't make it? Let us know with the button below.",
    bouton_annuler: "I can no longer come",
    calendrier: "The attached file adds the tour to your calendar.",
    cgv: "This leisure activity takes place on a set date: there is no right of withdrawal (article L221-28, 12° of the French Consumer Code). Your terms and conditions of sale:",
    lien_cgv: "read the terms",
    annulation_sujet: (d) => "Cancellation recorded: " + d,
    annulation_texte: "Your cancellation is recorded and your spot has been released.",
    annulation_frais: (m) => "As you cancelled less than 24 hours before, a late cancellation fee of " + m + " will be charged to the card used for the booking.",
    annulation_sans_frais: "The booking fee is kept; no other fee applies.",
    seance_annulee_sujet: (d) => "Session cancelled: " + d,
    seance_annulee_minimum: "The minimum number of participants was not reached: the session is cancelled.",
    seance_annulee_orga: "We are sorry: the session has been cancelled by the organisers.",
    rembourse: (m) => "You are fully refunded " + m + ". The refund shows on your account within 5 to 10 days.",
    tardif_sujet: (d) => "Booking not possible, you are refunded: " + d,
    tardif_texte: "Your payment arrived after the booking time limit, and the last spot was taken in the meantime.",
    frais_sujet: "Late cancellation fee",
    frais_texte: (m) => "A late cancellation or no-show fee of " + m + " has been charged to your card, as agreed when booking.",
    frais_payer_sujet: "Late cancellation fee to pay",
    frais_payer_texte: (m) => "Your bank asks for a confirmation to charge the late cancellation or no-show fee of " + m + ". Please pay it with the button below.",
    bouton_payer: "Pay the fee",
    fin: "See you soon on the Butte,",
    signature: "Mouvement Montmartre",
  },
  es: {
    bonjour: (n) => "Hola " + n + ",",
    confirmation_sujet: (d) => "Tu plaza está reservada: " + d,
    confirmation_intro: "Tu reserva está confirmada. Esto es lo esencial.",
    rappel_sujet: (d) => "Ya falta poco: " + d,
    rappel_intro: "Un pequeño recordatorio: tu visita se acerca. Esto es lo esencial.",
    date: "Fecha", personnes: "Personas", avec: "Con", rdv: "Punto de encuentro", ref: "Referencia",
    paye: "Pagado en línea", reste: (m, g) => "El resto, " + m + ", se paga en el lugar" + (g ? " a " + g : "") + ". Lleva efectivo.",
    mot: "Unas palabras de tu anfitrión",
    regle: (f) => "¿Ya no puedes venir? Avísanos con el botón de abajo para ofrecer la plaza a otra persona. La prerreserva no se devuelve. Con menos de 24 h de antelación, o si no te presentas, se cobran " + f + " de gastos por persona en la tarjeta utilizada.",
    regle_soiree: "¿Ya no puedes venir? Avísanos con el botón de abajo.",
    bouton_annuler: "Ya no puedo venir",
    calendrier: "El archivo adjunto añade la visita a tu calendario.",
    cgv: "Esta actividad de ocio tiene lugar en una fecha determinada: no da derecho de desistimiento (artículo L221-28, 12° del Código de consumo francés). Tus condiciones generales de venta:",
    lien_cgv: "leer las condiciones",
    annulation_sujet: (d) => "Cancelación registrada: " + d,
    annulation_texte: "Tu cancelación está registrada y tu plaza ha quedado libre.",
    annulation_frais: (m) => "Como la cancelación se hace con menos de 24 h de antelación, se cobrarán " + m + " de gastos de cancelación tardía en la tarjeta utilizada.",
    annulation_sans_frais: "La prerreserva no se devuelve; no se aplica ningún otro gasto.",
    seance_annulee_sujet: (d) => "Sesión cancelada: " + d,
    seance_annulee_minimum: "No se alcanzó el número mínimo de participantes: la sesión se cancela.",
    seance_annulee_orga: "Lo sentimos: la organización ha cancelado la sesión.",
    rembourse: (m) => "Se te reembolsan íntegramente " + m + ". El reembolso aparece en tu cuenta en 5 a 10 días.",
    tardif_sujet: (d) => "Reserva imposible, se te reembolsa: " + d,
    tardif_texte: "Tu pago llegó después del plazo de reserva y la última plaza se ocupó mientras tanto.",
    frais_sujet: "Gastos de cancelación tardía",
    frais_texte: (m) => "Se han cobrado en tu tarjeta " + m + " de gastos de cancelación tardía o de ausencia, según las condiciones aceptadas al reservar.",
    frais_payer_sujet: "Gastos de cancelación tardía por pagar",
    frais_payer_texte: (m) => "Tu banco pide una validación para cobrar " + m + " de gastos de cancelación tardía o de ausencia. Págalos con el botón de abajo.",
    bouton_payer: "Pagar los gastos",
    fin: "Hasta pronto en la Butte,",
    signature: "Mouvement Montmartre",
  },
};

const bouton = (lien, texte) =>
  '<p><a href="' + esc(lien) + '" style="display:inline-block;padding:12px 22px;border-radius:999px;' +
  'background:#14100E;color:#EFE8D8;text-decoration:none">' + esc(texte) + "</a></p>";
const ligne = (k, v) => v ? '<tr><td style="padding:4px 12px 4px 0;color:#5A4E44">' + esc(k) +
  '</td><td style="padding:4px 0"><b>' + esc(v) + "</b></td></tr>" : "";
const cadre = (corps) => '<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#14100E;max-width:520px">' + corps + "</div>";

/** Le texte brut est tiré du HTML : un seul contenu à maintenir. */
const versTexte = (html) => html
  .replace(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g, "$2 : $1")
  .replace(/<\/(p|tr|h2)>/g, "\n").replace(/<br>/g, "\n").replace(/<td[^>]*>/g, " ")
  .replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
  .replace(/\n{3,}/g, "\n\n").trim();

function ics(d) {
  const f = (iso) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const fin = d.fin || new Date(new Date(d.debut).getTime() + (d.duree_minutes || 120) * 60000).toISOString();
  const txt = (s) => String(s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Mouvement Montmartre//ArtDive//FR", "METHOD:PUBLISH",
    "BEGIN:VEVENT", "UID:" + d.reference + "@artdive.app", "DTSTAMP:" + f(new Date().toISOString()),
    "DTSTART:" + f(d.debut), "DTEND:" + f(fin), "SUMMARY:" + txt(titre(d, "fr")),
    "LOCATION:" + txt(d.point_rdv_precis || d.point_rdv), "DESCRIPTION:" + txt("Réservation " + d.reference),
    "END:VEVENT", "END:VCALENDAR", "",
  ].join("\r\n");
}

/** Fabrique l'email d'un envoi de la file : { sujet, html, texte, pieces }. */
function rediger(envoi) {
  const d = envoi.donnees || {};
  const l = T[envoi.langue] ? envoi.langue : "fr";
  const t = T[l];
  const nomVisite = titre(d, l);
  const lienResa = d.jeton ? SITE_URL + "/#reservation=" + d.jeton : null;
  const fraisPers = euros((d.frais_par_personne_centimes || 1000), l);
  const debut = d.debut ? quand(d.debut, l) : "";
  const recap = '<table style="border-collapse:collapse;margin:12px 0">' +
    ligne(t.date, debut) + ligne(t.personnes, String(d.personnes || "")) + ligne(t.avec, d.intervenant) +
    ligne(t.rdv, d.point_rdv_precis || d.point_rdv) + ligne(t.paye, euros(d.paye_en_ligne_centimes, l)) +
    ligne(t.ref, d.reference) + "</table>";
  const reste = estVisite(d) && d.reste_sur_place_centimes > 0
    ? "<p><b>" + esc(t.reste(euros(d.reste_sur_place_centimes, l), d.intervenant)) + "</b></p>" : "";
  const mot = d.message_inscrits ? "<p><b>" + esc(t.mot) + "</b><br>" + esc(d.message_inscrits) + "</p>" : "";
  const fin = "<p>" + esc(t.fin) + "<br>" + esc(t.signature) + "</p>";
  let sujet, corps, pieces;

  switch (envoi.type) {
    case "confirmation":
    case "rappel": {
      const c = envoi.type === "confirmation";
      sujet = c ? t.confirmation_sujet(nomVisite) : t.rappel_sujet(nomVisite);
      corps = "<p>" + esc(t.bonjour(d.nom || "")) + "</p><p>" + esc(c ? t.confirmation_intro : t.rappel_intro) + "</p>" +
        "<h2 style=\"font-size:20px;margin:16px 0 4px\">" + esc(nomVisite) + "</h2>" + recap + reste + mot +
        "<p>" + esc(estVisite(d) ? t.regle(fraisPers) : t.regle_soiree) + "</p>" +
        (lienResa ? bouton(lienResa, t.bouton_annuler) : "") + "<p style=\"font-size:13px;color:#5A4E44\">" + esc(t.calendrier) + "</p>" +
        (c ? "<p style=\"font-size:13px;color:#5A4E44\">" + esc(t.cgv) + ' <a href="' + esc(SITE_URL + "/cgv.html") + '">' + esc(t.lien_cgv) +
          (d.cgv_version ? " (" + esc(d.cgv_version) + ")" : "") + "</a></p>" : "") + fin;
      pieces = [{ name: "visite.ics", content: Buffer.from(ics(d), "utf8").toString("base64") }];
      break;
    }
    case "annulation_client":
      sujet = t.annulation_sujet(nomVisite);
      corps = "<p>" + esc(t.bonjour(d.nom || "")) + "</p><p>" + esc(t.annulation_texte) + "</p>" +
        "<p>" + esc(d.frais_centimes > 0 ? t.annulation_frais(euros(d.frais_centimes, l)) : (estVisite(d) ? t.annulation_sans_frais : "")) + "</p>" +
        recap + fin;
      break;
    case "seance_annulee":
      sujet = t.seance_annulee_sujet(nomVisite);
      corps = "<p>" + esc(t.bonjour(d.nom || "")) + "</p><p>" +
        esc(d.motif === "minimum_non_atteint" ? t.seance_annulee_minimum : t.seance_annulee_orga) + "</p>" +
        "<p>" + esc(t.rembourse(euros(d.paye_en_ligne_centimes, l))) + "</p>" + recap + fin;
      break;
    case "paiement_tardif":
      sujet = t.tardif_sujet(nomVisite);
      corps = "<p>" + esc(t.bonjour(d.nom || "")) + "</p><p>" + esc(t.tardif_texte) + "</p>" +
        "<p>" + esc(t.rembourse(euros(d.paye_en_ligne_centimes, l))) + "</p>" + fin;
      break;
    case "frais_preleves":
      sujet = t.frais_sujet;
      corps = "<p>" + esc(t.bonjour(d.nom || "")) + "</p><p>" + esc(t.frais_texte(euros(d.frais_centimes, l))) + "</p>" + recap + fin;
      break;
    case "frais_a_payer":
      sujet = t.frais_payer_sujet;
      corps = "<p>" + esc(t.bonjour(d.nom || "")) + "</p><p>" + esc(t.frais_payer_texte(euros(d.frais_centimes, l))) + "</p>" +
        (d.lien ? bouton(d.lien, t.bouton_payer) : "") + recap + fin;
      break;

    // ---- Alertes (association, guide ou artiste), en français ----
    case "alerte_inscription":
      sujet = "Nouvelle inscription : " + titre(d, "fr") + ", " + quand(d.debut, "fr");
      corps = "<p>Nouvelle inscription confirmée.</p>" + '<table style="border-collapse:collapse">' +
        ligne("Visite", titre(d, "fr")) + ligne("Date", quand(d.debut, "fr")) + ligne("Nom", d.nom) +
        ligne("Personnes", String(d.personnes)) + ligne("Téléphone", d.telephone) +
        ligne("Reste à encaisser sur place", euros(d.reste_sur_place_centimes, "fr")) + ligne("Référence", d.reference) + "</table>";
      break;
    case "alerte_annulation":
      sujet = "Annulation : " + titre(d, "fr") + ", " + quand(d.debut, "fr");
      corps = "<p>" + esc(d.nom) + " (" + esc(d.personnes) + " pers.) ne viendra pas. La place est de nouveau disponible.</p>" +
        (d.frais_centimes > 0 ? "<p>Annulation tardive : " + esc(euros(d.frais_centimes, "fr")) + " de frais seront prélevés.</p>" : "") +
        '<table style="border-collapse:collapse">' + ligne("Visite", titre(d, "fr")) + ligne("Date", quand(d.debut, "fr")) +
        ligne("Référence", d.reference) + "</table>";
      break;
    case "alerte_seance_annulee":
      sujet = "Séance annulée : " + titre(d, "fr") + ", " + quand(d.debut, "fr");
      corps = "<p>La séance est annulée (" + esc(d.motif === "minimum_non_atteint" ? "minimum de participants non atteint 48 h avant"
        : d.motif === "intervenant_empeche" ? "intervenant empêché" : "annulation par l'organisation") + ").</p>" +
        "<p>" + esc(d.inscrits_rembourses) + " réservation(s) remboursée(s) automatiquement, chaque inscrit a été prévenu par email.</p>";
      break;
    case "alerte_technique":
      sujet = "À vérifier : " + (d.probleme || "problème technique");
      corps = "<p>Une opération automatique a échoué plusieurs fois et demande une vérification dans Stripe.</p>" +
        '<table style="border-collapse:collapse">' + ligne("Problème", d.probleme) + ligne("Réservation", d.reference) +
        ligne("Nom", d.nom) + ligne("Détail", d.erreur) + "</table>";
      break;
    default:
      throw new Error("Type d'email inconnu : " + envoi.type);
  }
  const html = cadre(corps);
  return { sujet, html, texte: versTexte(html), pieces };
}

module.exports = { rediger, ics, esc };
