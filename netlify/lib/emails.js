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
const estVisite = (d) => d.type === "visite_guidee" || d.type === "atelier" || d.type === "escape_game";
/** Durée lisible : 150 → « 2 h 30 », 75 → « 1 h 15 », 45 → « 45 min ». */
const duree = (m) => { m = Number(m) || 0; if (!m) return ""; const h = Math.floor(m / 60), r = m % 60;
  return h ? h + " h" + (r ? " " + String(r).padStart(2, "0") : "") : r + " min"; };
const TYPES_FR = { visite_guidee: "Visite guidée", atelier: "Atelier", escape_game: "Escape game", soiree: "Soirée", autoguidee: "Parcours autoguidé" };
const PROFILS_FR = { guide: "Guide", artiste: "Artiste", lieu: "Lieu", autre: "Autre" };

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
    regle: (f, adh) => "Vous ne pouvez plus venir ? Prévenez-nous avec le bouton ci-dessous : la place sera proposée à quelqu'un d'autre." + (adh ? "" : " La pré-réservation reste acquise.") + " Moins de 24 h avant, ou en cas d'absence sans prévenir, " + f + " par personne sont prélevés sur la carte enregistrée au profit de l'association Mouvement Montmartre, sans dépasser le solde de la séance.",
    offerte: "Pré-réservation offerte (adhérent)",
    regle_soiree: "Vous ne pouvez plus venir ? Prévenez-nous avec le bouton ci-dessous.",
    bouton_annuler: "Je ne peux plus venir",
    calendrier: "Le fichier joint ajoute la visite à votre calendrier.",
    cgv: "Cette activité de loisirs a lieu à une date déterminée : elle n'ouvre pas de droit de rétractation (article L221-28, 12° du Code de la consommation). Vos conditions générales de vente :",
    lien_cgv: "lire les CGV",
    annulation_sujet: (d) => "Annulation enregistrée : " + d,
    annulation_texte: "Votre annulation est enregistrée et votre place a été libérée.",
    annulation_frais: (m) => "L'annulation intervenant moins de 24 h avant, " + m + " de frais d'annulation tardive vont être prélevés sur la carte enregistrée, au profit de l'association Mouvement Montmartre.",
    annulation_sans_frais: "La pré-réservation reste acquise, aucun autre frais n'est appliqué.",
    annulation_sans_frais_adh: "Aucun frais n'est appliqué.",
    seance_annulee_sujet: (d) => "Séance annulée : " + d,
    seance_annulee_minimum: "Le nombre minimum de participants n'a pas été atteint : la séance est annulée.",
    seance_annulee_orga: "Nous sommes désolés : la séance est annulée par l'organisation.",
    rembourse: (m) => "Vous êtes remboursé intégralement de " + m + ". Le remboursement apparaît sur votre compte sous 5 à 10 jours.",
    tardif_sujet: (d) => "Réservation impossible, vous êtes remboursé : " + d,
    tardif_texte: "Votre paiement est arrivé après la fin du délai de réservation, et la dernière place a été prise entre-temps.",
    tardif_sujet_0: (d) => "Réservation impossible : " + d,
    tardif_texte_0: "Votre réservation a été terminée après la fin du délai de 15 minutes, et la dernière place a été prise entre-temps. Rien n'a été prélevé : choisissez une autre date dans ArtDive.",
    frais_sujet: "Frais d'absence ou d'annulation tardive",
    frais_texte: (m) => m + " de frais d'annulation tardive ou d'absence ont été prélevés sur votre carte au profit de l'association Mouvement Montmartre, conformément aux conditions acceptées lors de la réservation.",
    frais_payer_sujet: "Frais d'annulation tardive à régler",
    frais_payer_texte: (m) => "Votre banque demande une validation pour le prélèvement de " + m + " de frais d'annulation tardive ou d'absence. Merci de le régler avec le bouton ci-dessous.",
    bouton_payer: "Régler les frais",
    absence_sujet: (d) => "Votre absence à « " + d + " »",
    absence_titre: (n) => "Bonjour " + n + ", nous ne vous avons pas vu.",
    absence_texte: (v, q, g) => "Vous étiez inscrit(e) à la visite " + v + ", le " + q + ", et " + (g || "l'intervenant") + " a signalé votre absence.",
    absence_prevu: "Prélèvement prévu demain",
    absence_detail: (n, f, plafond) => n + " personne" + (n > 1 ? "s" : "") + " × " + f + (plafond ? ", dans la limite du solde de la séance" : "") + ", prélevés sur la carte enregistrée au profit de l'association Mouvement Montmartre, comme indiqué dans les conditions acceptées à la réservation.",
    absence_contester: "Vous étiez bien là, ou vous aviez prévenu ? Dites-le-nous avant demain 12 h : le prélèvement sera annulé.",
    absence_bouton: "Je me suis présenté(e)",
    absence_echec: "Si le prélèvement n'aboutit pas, nous vous enverrons un lien pour régler le montant dû. Mouvement Montmartre · Paris 18e.",
    relance_sujet: (j) => j <= 7 ? "Votre adhésion arrive à échéance dans 7 jours" : "Votre adhésion arrive à échéance dans un mois",
    relance_auto: (f) => "Votre adhésion au Mouvement Montmartre sera renouvelée automatiquement le " + f + " pour 5 €, pour 12 mois. Vous n'avez rien à faire.",
    relance_resilier: "Vous pouvez la résilier à tout moment avant cette date, sans frais : ouvrez votre carte de membre dans ArtDive, puis « Gérer mon abonnement ».",
    relance_fin: (f) => "Votre adhésion au Mouvement Montmartre se termine le " + f + ". Pour garder vos avantages (réservation des visites et ateliers, évènements privés), renouvelez-la pour 5 € par an.",
    relance_bouton: "Ouvrir ma carte de membre",
    relance_numero: "Membre n°",
    fin: "À bientôt sur la Butte,",
    signature: "Mouvement Montmartre",
    modif_sujet: (d) => "Changement pour votre réservation : " + d,
    modif_intro: "L'intervenant a modifié la séance que vous avez réservée. Voici les nouvelles informations.",
    modif_avant: (q) => "Avant : " + q + ".",
    modif_langue: "Langue de la séance",
    modif_annuler: "Ce changement ne vous convient pas ? Vous pouvez annuler sans frais, même moins de 24 h avant, avec le bouton ci-dessous.",
    langues: { fr: "français", en: "anglais", es: "espagnol", zh: "chinois", ar: "arabe", ru: "russe" },
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
    regle: (f, adh) => "Can't make it? Let us know with the button below so the spot can go to someone else." + (adh ? "" : " The booking fee is non refundable.") + " Less than 24 hours before, or if you do not show up, " + f + " per person is charged to the saved card for the Mouvement Montmartre association, never more than the balance of the session.",
    offerte: "Booking fee waived (member)",
    regle_soiree: "Can't make it? Let us know with the button below.",
    bouton_annuler: "I can no longer come",
    calendrier: "The attached file adds the tour to your calendar.",
    cgv: "This leisure activity takes place on a set date: there is no right of withdrawal (article L221-28, 12° of the French Consumer Code). Your terms and conditions of sale:",
    lien_cgv: "read the terms",
    annulation_sujet: (d) => "Cancellation recorded: " + d,
    annulation_texte: "Your cancellation is recorded and your spot has been released.",
    annulation_frais: (m) => "As you cancelled less than 24 hours before, a late cancellation fee of " + m + " will be charged to the saved card, for the Mouvement Montmartre association.",
    annulation_sans_frais: "The booking fee is kept; no other fee applies.",
    annulation_sans_frais_adh: "No fee applies.",
    seance_annulee_sujet: (d) => "Session cancelled: " + d,
    seance_annulee_minimum: "The minimum number of participants was not reached: the session is cancelled.",
    seance_annulee_orga: "We are sorry: the session has been cancelled by the organisers.",
    rembourse: (m) => "You are fully refunded " + m + ". The refund shows on your account within 5 to 10 days.",
    tardif_sujet: (d) => "Booking not possible, you are refunded: " + d,
    tardif_texte: "Your payment arrived after the booking time limit, and the last spot was taken in the meantime.",
    tardif_sujet_0: (d) => "Booking not possible: " + d,
    tardif_texte_0: "Your booking was completed after the 15-minute limit, and the last spot was taken in the meantime. Nothing was charged: choose another date in ArtDive.",
    frais_sujet: "No-show or late cancellation fee",
    frais_texte: (m) => "A late cancellation or no-show fee of " + m + " has been charged to your card for the Mouvement Montmartre association, as agreed when booking.",
    frais_payer_sujet: "Late cancellation fee to pay",
    frais_payer_texte: (m) => "Your bank asks for a confirmation to charge the late cancellation or no-show fee of " + m + ". Please pay it with the button below.",
    bouton_payer: "Pay the fee",
    absence_sujet: (d) => "You missed \"" + d + "\"",
    absence_titre: (n) => "Hello " + n + ", we did not see you.",
    absence_texte: (v, q, g) => "You were booked on " + v + ", " + q + ", and " + (g || "your host") + " reported that you did not come.",
    absence_prevu: "Charge planned tomorrow",
    absence_detail: (n, f, plafond) => n + (n > 1 ? " people" : " person") + " × " + f + (plafond ? ", up to the balance of the session" : "") + ", charged to the saved card for the Mouvement Montmartre association, as stated in the terms accepted when booking.",
    absence_contester: "You were there, or you had let us know? Tell us before tomorrow 12 pm: the charge will be cancelled.",
    absence_bouton: "I was there",
    absence_echec: "If the charge fails, we will send you a link to pay the amount due. Mouvement Montmartre · Paris 18th.",
    relance_sujet: (j) => j <= 7 ? "Your membership ends in 7 days" : "Your membership ends in a month",
    relance_auto: (f) => "Your Mouvement Montmartre membership will renew automatically on " + f + " for €5, for 12 months. You have nothing to do.",
    relance_resilier: "You can cancel it at any time before that date, free of charge: open your member card in ArtDive, then \"Manage my subscription\".",
    relance_fin: (f) => "Your Mouvement Montmartre membership ends on " + f + ". To keep your benefits (booking tours and workshops, private events), renew it for €5 a year.",
    relance_bouton: "Open my member card",
    relance_numero: "Member no.",
    fin: "See you soon on the Butte,",
    signature: "Mouvement Montmartre",
    modif_sujet: (d) => "Change to your booking: " + d,
    modif_intro: "Your host has changed the session you booked. Here are the new details.",
    modif_avant: (q) => "Before: " + q + ".",
    modif_langue: "Language of the session",
    modif_annuler: "Does this change not suit you? You can cancel free of charge, even less than 24 hours before, with the button below.",
    langues: { fr: "French", en: "English", es: "Spanish", zh: "Chinese", ar: "Arabic", ru: "Russian" },
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
    regle: (f, adh) => "¿Ya no puedes venir? Avísanos con el botón de abajo para ofrecer la plaza a otra persona." + (adh ? "" : " La prerreserva no se devuelve.") + " Con menos de 24 h de antelación, o si no te presentas, se cobran " + f + " por persona en la tarjeta guardada a favor de la asociación Mouvement Montmartre, sin superar el saldo de la sesión.",
    offerte: "Prerreserva gratuita (socio)",
    regle_soiree: "¿Ya no puedes venir? Avísanos con el botón de abajo.",
    bouton_annuler: "Ya no puedo venir",
    calendrier: "El archivo adjunto añade la visita a tu calendario.",
    cgv: "Esta actividad de ocio tiene lugar en una fecha determinada: no da derecho de desistimiento (artículo L221-28, 12° del Código de consumo francés). Tus condiciones generales de venta:",
    lien_cgv: "leer las condiciones",
    annulation_sujet: (d) => "Cancelación registrada: " + d,
    annulation_texte: "Tu cancelación está registrada y tu plaza ha quedado libre.",
    annulation_frais: (m) => "Como la cancelación se hace con menos de 24 h de antelación, se cobrarán " + m + " de gastos de cancelación tardía en la tarjeta guardada, a favor de la asociación Mouvement Montmartre.",
    annulation_sans_frais: "La prerreserva no se devuelve; no se aplica ningún otro gasto.",
    annulation_sans_frais_adh: "No se aplica ningún gasto.",
    seance_annulee_sujet: (d) => "Sesión cancelada: " + d,
    seance_annulee_minimum: "No se alcanzó el número mínimo de participantes: la sesión se cancela.",
    seance_annulee_orga: "Lo sentimos: la organización ha cancelado la sesión.",
    rembourse: (m) => "Se te reembolsan íntegramente " + m + ". El reembolso aparece en tu cuenta en 5 a 10 días.",
    tardif_sujet: (d) => "Reserva imposible, se te reembolsa: " + d,
    tardif_texte: "Tu pago llegó después del plazo de reserva y la última plaza se ocupó mientras tanto.",
    tardif_sujet_0: (d) => "Reserva imposible: " + d,
    tardif_texte_0: "Tu reserva se completó después del plazo de 15 minutos y la última plaza se ocupó mientras tanto. No se ha cobrado nada: elige otra fecha en ArtDive.",
    frais_sujet: "Gastos de ausencia o de cancelación tardía",
    frais_texte: (m) => "Se han cobrado en tu tarjeta " + m + " de gastos de cancelación tardía o de ausencia a favor de la asociación Mouvement Montmartre, según las condiciones aceptadas al reservar.",
    frais_payer_sujet: "Gastos de cancelación tardía por pagar",
    frais_payer_texte: (m) => "Tu banco pide una validación para cobrar " + m + " de gastos de cancelación tardía o de ausencia. Págalos con el botón de abajo.",
    bouton_payer: "Pagar los gastos",
    absence_sujet: (d) => "Tu ausencia en «" + d + "»",
    absence_titre: (n) => "Hola " + n + ", no te vimos.",
    absence_texte: (v, q, g) => "Estabas inscrito(a) en " + v + ", el " + q + ", y " + (g || "el anfitrión") + " ha señalado tu ausencia.",
    absence_prevu: "Cobro previsto mañana",
    absence_detail: (n, f, plafond) => n + (n > 1 ? " personas" : " persona") + " × " + f + (plafond ? ", sin superar el saldo de la sesión" : "") + ", cobrados en la tarjeta guardada a favor de la asociación Mouvement Montmartre, según las condiciones aceptadas al reservar.",
    absence_contester: "¿Sí estuviste, o habías avisado? Dínoslo antes de mañana a las 12 h: el cobro se cancelará.",
    absence_bouton: "Sí estuve",
    absence_echec: "Si el cobro no se realiza, te enviaremos un enlace para pagar el importe debido. Mouvement Montmartre · París 18.",
    relance_sujet: (j) => j <= 7 ? "Tu membresía termina en 7 días" : "Tu membresía termina en un mes",
    relance_auto: (f) => "Tu membresía del Mouvement Montmartre se renovará automáticamente el " + f + " por 5 €, por 12 meses. No tienes que hacer nada.",
    relance_resilier: "Puedes cancelarla en cualquier momento antes de esa fecha, sin gastos: abre tu tarjeta de socio en ArtDive y luego «Gestionar mi suscripción».",
    relance_fin: (f) => "Tu membresía del Mouvement Montmartre termina el " + f + ". Para conservar tus ventajas (reserva de visitas y talleres, eventos privados), renuévala por 5 € al año.",
    relance_bouton: "Abrir mi tarjeta de socio",
    relance_numero: "Socio n.º",
    fin: "Hasta pronto en la Butte,",
    signature: "Mouvement Montmartre",
    modif_sujet: (d) => "Cambio en tu reserva: " + d,
    modif_intro: "Tu anfitrión ha modificado la sesión que reservaste. Estos son los nuevos datos.",
    modif_avant: (q) => "Antes: " + q + ".",
    modif_langue: "Idioma de la sesión",
    modif_annuler: "¿Este cambio no te viene bien? Puedes cancelar sin gastos, incluso con menos de 24 h de antelación, con el botón de abajo.",
    langues: { fr: "francés", en: "inglés", es: "español", zh: "chino", ar: "árabe", ru: "ruso" },
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
  .replace(/<\/(p|tr|h2|div)>/g, "\n").replace(/<br>/g, "\n").replace(/<td[^>]*>/g, " ")
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
    ligne(t.rdv, d.point_rdv_precis || d.point_rdv) +
    ligne(t.paye, d.adherent && !d.paye_en_ligne_centimes ? t.offerte : euros(d.paye_en_ligne_centimes, l)) +
    ligne(t.ref, d.reference) + "</table>";
  const reste = estVisite(d) && d.reste_sur_place_centimes > 0
    ? "<p><b>" + esc(t.reste(euros(d.reste_sur_place_centimes, l), d.intervenant)) + "</b></p>" : "";
  const mot = d.message_inscrits ? "<p><b>" + esc(t.mot) + "</b><br>" + esc(d.message_inscrits) + "</p>" : "";
  const fin = "<p>" + esc(t.fin) + "<br>" + esc(t.signature) + "</p>", fin_ = fin;
  let sujet, corps, pieces;

  switch (envoi.type) {
    case "confirmation":
    case "rappel": {
      const c = envoi.type === "confirmation";
      sujet = c ? t.confirmation_sujet(nomVisite) : t.rappel_sujet(nomVisite);
      corps = "<p>" + esc(t.bonjour(d.nom || "")) + "</p><p>" + esc(c ? t.confirmation_intro : t.rappel_intro) + "</p>" +
        "<h2 style=\"font-size:20px;margin:16px 0 4px\">" + esc(nomVisite) + "</h2>" + recap + reste + mot +
        "<p>" + esc(estVisite(d) ? t.regle(fraisPers, d.adherent) : t.regle_soiree) + "</p>" +
        (lienResa ? bouton(lienResa, t.bouton_annuler) : "") + "<p style=\"font-size:13px;color:#5A4E44\">" + esc(t.calendrier) + "</p>" +
        (c ? "<p style=\"font-size:13px;color:#5A4E44\">" + esc(t.cgv) + ' <a href="' + esc(SITE_URL + "/cgv.html") + '">' + esc(t.lien_cgv) +
          (d.cgv_version ? " (" + esc(d.cgv_version) + ")" : "") + "</a></p>" : "") + fin;
      pieces = [{ name: "visite.ics", content: Buffer.from(ics(d), "utf8").toString("base64") }];
      break;
    }
    case "annulation_client":
      sujet = t.annulation_sujet(nomVisite);
      corps = "<p>" + esc(t.bonjour(d.nom || "")) + "</p><p>" + esc(t.annulation_texte) + "</p>" +
        "<p>" + esc(d.frais_centimes > 0 ? t.annulation_frais(euros(d.frais_centimes, l)) : (estVisite(d) ? (d.adherent ? t.annulation_sans_frais_adh : t.annulation_sans_frais) : "")) + "</p>" +
        recap + fin;
      break;
    case "seance_annulee":
      sujet = t.seance_annulee_sujet(nomVisite);
      corps = "<p>" + esc(t.bonjour(d.nom || "")) + "</p><p>" +
        esc(d.motif === "minimum_non_atteint" ? t.seance_annulee_minimum : t.seance_annulee_orga) + "</p>" +
        (d.paye_en_ligne_centimes > 0 ? "<p>" + esc(t.rembourse(euros(d.paye_en_ligne_centimes, l))) + "</p>" : "") + recap + fin;
      break;
    case "paiement_tardif":
      sujet = d.paye_en_ligne_centimes > 0 ? t.tardif_sujet(nomVisite) : t.tardif_sujet_0(nomVisite);
      corps = "<p>" + esc(t.bonjour(d.nom || "")) + "</p><p>" + esc(d.paye_en_ligne_centimes > 0 ? t.tardif_texte : t.tardif_texte_0) + "</p>" +
        (d.paye_en_ligne_centimes > 0 ? "<p>" + esc(t.rembourse(euros(d.paye_en_ligne_centimes, l))) + "</p>" : "") + fin;
      break;
    case "frais_preleves":
      sujet = t.frais_sujet;
      corps = "<p>" + esc(t.bonjour(d.nom || "")) + "</p><p>" + esc(t.frais_texte(euros(d.frais_centimes, l))) + "</p>" + recap + fin;
      break;
    case "absence": {
      const frais = d.frais_centimes || 0, n = d.personnes || 1;
      sujet = t.absence_sujet(nomVisite);
      corps = "<p><b>" + esc(t.absence_titre(d.nom || "")) + "</b></p><p>" + esc(t.absence_texte(nomVisite, debut, d.intervenant)) + "</p>" +
        '<div style="background:#F3EBDD;border-radius:12px;padding:14px 16px;margin:12px 0"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7A5B1F">' +
        esc(t.absence_prevu) + '</div><div style="font-size:30px;margin:4px 0">' + esc(euros(frais, l)) + '</div><div style="font-size:14px;color:#5A4E44">' +
        esc(t.absence_detail(n, fraisPers, frais < (d.frais_par_personne_centimes || 1000) * n)) + "</div></div>" +
        "<p>" + esc(t.absence_contester) + "</p>" + (lienResa ? bouton(lienResa, t.absence_bouton) : "") +
        '<p style="font-size:13px;color:#5A4E44">' + esc(t.absence_echec) + "</p>";
      break;
    }
    case "relance_adhesion": {
      const fin = d.fin ? new Intl.DateTimeFormat(LOCALES[l] || "fr-FR", { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" }).format(new Date(d.fin)) : "";
      sujet = t.relance_sujet(d.jours);
      corps = "<p>" + esc(t.bonjour(d.nom || "")) + "</p>" +
        (d.renouvelable ? "<p>" + esc(t.relance_auto(fin)) + "</p><p>" + esc(t.relance_resilier) + "</p>" : "<p>" + esc(t.relance_fin(fin)) + "</p>") +
        bouton(SITE_URL + "/#membre", t.relance_bouton) +
        (d.numero ? '<p style="font-size:13px;color:#5A4E44">' + esc(t.relance_numero) + " " + esc(d.numero) + "</p>" : "") + fin_;
      break;
    }
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
        ligne("Personnes", String(d.personnes)) + ligne("Téléphone", d.telephone) + ligne("Adhérent", d.adherent ? "oui" : "") +
        ligne("Reste à encaisser sur place", euros(d.reste_sur_place_centimes, "fr")) + ligne("Référence", d.reference) + "</table>";
      break;
    case "alerte_annulation":
      sujet = "Annulation : " + titre(d, "fr") + ", " + quand(d.debut, "fr");
      corps = "<p>" + esc(d.nom) + " (" + esc(d.personnes) + " pers.) ne viendra pas. La place est de nouveau disponible.</p>" +
        (d.frais_centimes > 0 ? "<p>Annulation tardive : " + esc(euros(d.frais_centimes, "fr")) + " de frais seront prélevés au profit de l'association (non reversés à l'intervenant).</p>" : "") +
        '<table style="border-collapse:collapse">' + ligne("Visite", titre(d, "fr")) + ligne("Date", quand(d.debut, "fr")) +
        ligne("Référence", d.reference) + "</table>";
      break;
    case "alerte_presence":
      sujet = "Absence contestée : " + titre(d, "fr") + ", " + quand(d.debut, "fr");
      corps = "<p>" + esc(d.nom) + " (" + esc(d.personnes) + " pers.) indique s'être présenté(e) ou avoir prévenu. Le prélèvement de " +
        esc(euros(d.frais_annules_centimes || 0, "fr")) + " prévu pour absence est annulé.</p>" +
        "<p>En cas de désaccord, répondez à cet email pour en parler avec l'association.</p>" +
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
    case "seance_modifiee": {
      const avant = [d.date_changee && d.ancien_debut ? quand(d.ancien_debut, l) : "", d.lieu_change ? d.ancien_point_rdv : ""].filter(Boolean).join(", ");
      sujet = t.modif_sujet(nomVisite);
      corps = "<p>" + esc(t.bonjour(d.nom || "")) + "</p><p>" + esc(t.modif_intro) + "</p>" +
        "<h2 style=\"font-size:20px;margin:16px 0 4px\">" + esc(nomVisite) + "</h2>" + recap +
        (d.langue_changee ? '<table style="border-collapse:collapse">' + ligne(t.modif_langue, t.langues[d.langue_seance] || d.langue_seance) + "</table>" : "") +
        (avant ? '<p style="font-size:14px;color:#5A4E44">' + esc(t.modif_avant(avant)) + "</p>" : "") + mot +
        "<p>" + esc(t.modif_annuler) + "</p>" + (lienResa ? bouton(lienResa, t.bouton_annuler) : "") + fin;
      pieces = [{ name: "visite.ics", content: Buffer.from(ics(d), "utf8").toString("base64") }];
      break;
    }

    // ---- Information de l'association (en français, « Répondre » écrit à la personne) ----
    case "alerte_candidature":
    case "alerte_demande": {
      const cand = envoi.type === "alerte_candidature";
      sujet = (d.a_verifier ? "[À vérifier : envoi très rapide] " : "") + (d.sujet || (cand ? "ArtDive : nouvelle candidature de " + d.nom : "ArtDive : nouvelle demande de " + d.nom));
      corps = "<p>" + esc(cand ? "Nouvelle candidature pour devenir intervenant sur ArtDive." : "Nouvelle demande de visite ou d'atelier privé.") + "</p>" +
        '<table style="border-collapse:collapse">' + (d.lignes || []).map((x) => ligne(x[0], x[1] == null ? "" : String(x[1]))).join("") + "</table>" +
        (d.message ? '<p style="white-space:pre-line">' + esc(d.message) + "</p>" : "") +
        "<p>Pour répondre, utilisez simplement « Répondre » : l'email part chez " + esc(d.nom) + ".</p>" +
        bouton(SITE_URL + (cand ? "/#espace=valider" : "/#espace=demandes"), cand ? "Valider ou refuser la candidature" : "Ouvrir l'onglet Demandes");
      break;
    }
    case "alerte_experience":
      sujet = (d.renvoyee ? "Expérience corrigée à valider : " : "Nouvelle expérience à valider : ") + titre(d, "fr") + " (" + (d.intervenant || "") + ")";
      corps = "<p>" + esc(d.intervenant || "Un intervenant") + (d.renvoyee ? " a corrigé et renvoyé son expérience." : " propose une nouvelle expérience.") + "</p>" +
        '<table style="border-collapse:collapse">' + ligne("Titre", titre(d, "fr")) + ligne("Type", TYPES_FR[d.type] || d.type) +
        ligne("Prix par personne (sur place)", d.prix_centimes != null ? euros(d.prix_centimes, "fr") : "") +
        ligne("Places", d.capacite_max ? String(d.capacite_max) : "") + ligne("Durée", duree(d.duree_minutes)) +
        ligne("Langues", (d.langues || []).join(", ")) + ligne("Rendez-vous", d.point_rdv && d.point_rdv.fr) + "</table>" +
        (d.description && d.description.fr ? '<p style="white-space:pre-line">' + esc(d.description.fr) + "</p>" : "") +
        bouton(SITE_URL + "/#espace=valider", "Valider ou refuser") +
        "<p style=\"font-size:13px;color:#5A4E44\">« Répondre » écrit directement à l'intervenant.</p>";
      break;
    case "alerte_seances_publiees": {
      const ss = d.seances || [];
      sujet = (ss.length > 1 ? ss.length + " séances publiées" : "Séance publiée") + " par " + (d.intervenant || "un intervenant");
      corps = "<p>Pour information : " + esc(d.intervenant || "un intervenant") + (ss.length > 1 ? " a mis en ligne " + ss.length + " séances." : " a mis en ligne une séance.") +
        " Elles sont réservables tout de suite, aucune action n'est nécessaire.</p>" +
        '<table style="border-collapse:collapse">' + ss.map((x) => ligne(quand(x.debut, "fr"),
          [titre(x, "fr"), x.fin ? duree(Math.round((new Date(x.fin) - new Date(x.debut)) / 60000)) : "", (x.langue || "").toUpperCase(),
           x.point_rdv, x.capacite_max + " places, minimum " + x.participants_min, x.prix_centimes != null ? euros(x.prix_centimes, "fr") + " par personne" : ""]
            .filter(Boolean).join(" · "))).join("") + "</table>" +
        bouton(SITE_URL + "/#espace=seances", "Voir les séances");
      break;
    }

    // ---- Intervenants (en français) ----
    case "acces_intervenant":
      sujet = "Votre espace intervenant ArtDive est ouvert";
      corps = "<p>Bonjour " + esc(d.nom || "") + ",</p>" +
        "<p>Bonne nouvelle : le Mouvement Montmartre a accepté votre candidature. Votre espace intervenant est ouvert : " +
        "décrivez votre première expérience (visite, atelier ou escape game), l'association la relit puis la valide, et vous pourrez publier vos séances.</p>" +
        (d.lien ? bouton(d.lien, "Ouvrir mon espace") : "") +
        '<p style="font-size:13px;color:#5A4E44">Ce lien vous connecte directement ; il est personnel et valable 7 jours. Ensuite, ouvrez ArtDive, touchez « Infos » puis « Mon compte » ' +
        "et entrez cette adresse email : vous recevrez un code à 6 chiffres. Pas de mot de passe à retenir.</p>" +
        "<p>À très vite sur la Butte,<br>Mouvement Montmartre · Paris 18e.</p>";
      break;
    case "experience_validee":
      sujet = "Votre expérience « " + titre(d, "fr") + " » est validée";
      corps = '<h2 style="font-size:22px;margin:0 0 8px">Bonne nouvelle, votre expérience est validée.</h2>' +
        "<p>Bonjour " + esc(d.nom || "") + ", " + esc(titre(d, "fr")) + " est prête. Il ne reste plus qu'à choisir vos dates : " +
        "créez votre première séance, elle sera en ligne tout de suite.</p>" +
        '<div style="background:#F3EBDD;border-radius:12px;padding:14px 16px;margin:12px 0"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7A5B1F">Prochaine étape</div>' +
        '<div style="font-size:18px;margin:4px 0"><b>Créer une séance</b></div><div style="font-size:14px;color:#5A4E44">Le lien vous connecte directement à votre espace intervenants.</div></div>' +
        (d.lien ? bouton(d.lien, "Créer ma première séance") : "") +
        '<p style="font-size:13px;color:#5A4E44">Lien personnel, valable 7 jours. Ensuite : « Infos », « Mon compte », et le code reçu par email.</p>' +
        "<p>Mouvement Montmartre · Paris 18e.</p>";
      break;
    case "experience_refusee":
      sujet = "Votre expérience « " + titre(d, "fr") + " » : à revoir";
      corps = "<p>Bonjour " + esc(d.nom || "") + ",</p><p>L'association a relu votre expérience « " + esc(titre(d, "fr")) + " » et ne peut pas la mettre en ligne en l'état.</p>" +
        (d.motif ? '<div style="background:#F3EBDD;border-radius:12px;padding:14px 16px;margin:12px 0"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7A5B1F">Motif</div><div style="white-space:pre-line">' + esc(d.motif) + "</div></div>" : "") +
        "<p>Vous pouvez la corriger dans votre espace puis la renvoyer pour validation. Une question ? Répondez simplement à cet email.</p>" +
        (d.lien ? bouton(d.lien, "Modifier mon expérience") : "") + "<p>Mouvement Montmartre · Paris 18e.</p>";
      break;
    case "candidature_refusee":
      sujet = "Votre candidature ArtDive";
      corps = "<p>Bonjour " + esc(d.nom || "") + ",</p><p>Merci pour votre intérêt pour ArtDive. Après lecture, le Mouvement Montmartre ne peut pas donner suite à votre candidature pour le moment.</p>" +
        (d.motif ? '<div style="background:#F3EBDD;border-radius:12px;padding:14px 16px;margin:12px 0"><div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#7A5B1F">Motif</div><div style="white-space:pre-line">' + esc(d.motif) + "</div></div>" : "") +
        "<p>Une question ? Répondez simplement à cet email.</p><p>Mouvement Montmartre · Paris 18e.</p>";
      break;

    default:
      throw new Error("Type d'email inconnu : " + envoi.type);
  }
  const html = cadre(corps);
  return { sujet, html, texte: versTexte(html), pieces };
}

/** Invitation d'un intervenant à son espace (en français : les intervenants sont des partenaires locaux). */
function redigerInvitation({ nom, lien }) {
  const corps =
    "<p>Bonjour " + esc(nom) + ",</p>" +
    "<p>Le Mouvement Montmartre vous ouvre votre espace intervenant sur ArtDive. Vous pourrez y suivre vos séances et vos inscrits, " +
    "et mettre à jour votre fiche et vos visites.</p>" +
    bouton(lien, "Ouvrir mon espace") +
    "<p>Ce lien est personnel et valable 15 minutes. Ensuite, ouvrez ArtDive, touchez « Infos » puis « Espace intervenants », " +
    "et demandez un nouveau lien avec cette adresse email. Pas de mot de passe à retenir.</p>" +
    "<p>À très vite sur la Butte,<br>Mouvement Montmartre</p>";
  const html = cadre(corps);
  return { sujet: "Votre espace intervenant ArtDive", html, texte: versTexte(html) };
}

/** Lien d'accès à un parcours autoguidé, avec le rappel de l'accès immédiat et du renoncement (CGV art. 16.3). */
function redigerAcces({ langue, titre, etapes, lien, reference, montant, audioguide }) {
  const l = LOCALES[langue] ? langue : "fr";
  const t = {
    fr: { sujet: "Votre parcours : " + titre, bonjour: "Bonjour,", intro: "Votre parcours « " + titre + " » est débloqué" + (etapes ? " (" + etapes + " étapes)" : "") + (audioguide ? ", avec l'audioguide" : "") + ".",
      bouton: "Ouvrir le parcours", garder: "Gardez cet email : ce lien personnel vous permet de retrouver le parcours sur n'importe quel téléphone. Ne le partagez pas.",
      ligneRef: "Référence", lignePaye: "Payé", droit: "Vous avez demandé l'accès immédiat au parcours et reconnu perdre votre droit de rétractation dès son début (article L221-28, 13° du Code de la consommation).",
      fin: "Bonne balade sur la Butte," },
    en: { sujet: "Your tour: " + titre, bonjour: "Hello,", intro: "Your tour \"" + titre + "\" is unlocked" + (etapes ? " (" + etapes + " stops)" : "") + (audioguide ? ", with the audio guide" : "") + ".",
      bouton: "Open the tour", garder: "Keep this email: this personal link lets you find the tour again on any phone. Do not share it.",
      ligneRef: "Reference", lignePaye: "Paid", droit: "You asked for immediate access to the tour and acknowledged that you lose your right of withdrawal once it starts (article L221-28, 13° of the French Consumer Code).",
      fin: "Enjoy your walk on the Butte," },
    es: { sujet: "Tu recorrido: " + titre, bonjour: "Hola,", intro: "Tu recorrido «" + titre + "» está desbloqueado" + (etapes ? " (" + etapes + " etapas)" : "") + (audioguide ? ", con la audioguía" : "") + ".",
      bouton: "Abrir el recorrido", garder: "Guarda este email: este enlace personal te permite volver al recorrido desde cualquier móvil. No lo compartas.",
      ligneRef: "Referencia", lignePaye: "Pagado", droit: "Pediste el acceso inmediato al recorrido y reconociste perder tu derecho de desistimiento desde su inicio (artículo L221-28, 13° del Código de consumo francés).",
      fin: "Buen paseo por la Butte," },
  }[l];
  const corps = "<p>" + esc(t.bonjour) + "</p><p>" + esc(t.intro) + "</p>" + bouton(lien, t.bouton) + "<p>" + esc(t.garder) + "</p>" +
    '<table style="border-collapse:collapse">' + ligne(t.ligneRef, reference) + ligne(t.lignePaye, euros(montant, l)) + "</table>" +
    '<p style="font-size:13px;color:#5A4E44">' + esc(t.droit) + "</p><p>" + esc(t.fin) + "<br>Mouvement Montmartre</p>";
  const html = cadre(corps);
  return { sujet: t.sujet, html, texte: versTexte(html) };
}

/** Demande privée ou candidature acceptée : coordonnées de l'association pour la suite (décision du 19/11). */
const CONTACT_ACCEPTATION = { nom: "Lucie", tel: "07 69 99 57 64", email: "mouvementmontmartre@gmail.com" };
function redigerAcceptation({ langue, nom, quoi }) {
  const l = ["fr", "en", "es"].includes(langue) ? langue : "fr";
  const c = CONTACT_ACCEPTATION;
  const t = {
    fr: { sujet: quoi === "candidature" ? "Votre candidature ArtDive est acceptée" : "Votre demande privée est acceptée",
      bonjour: "Bonjour " + nom + ",",
      intro: quoi === "candidature" ? "Bonne nouvelle : votre candidature pour rejoindre ArtDive est acceptée."
        : "Bonne nouvelle : votre demande de visite ou d'atelier privé est acceptée.",
      suite: quoi === "candidature" ? "Pour la suite, contactez " + c.nom + " :" : "Pour fixer ensemble la date, le programme et le tarif, contactez " + c.nom + " :",
      repondre: "Vous pouvez aussi simplement répondre à cet email.", fin: "À très vite sur la Butte," },
    en: { sujet: quoi === "candidature" ? "Your ArtDive application is accepted" : "Your private request is accepted",
      bonjour: "Hello " + nom + ",",
      intro: quoi === "candidature" ? "Good news: your application to join ArtDive is accepted." : "Good news: your request for a private tour or workshop is accepted.",
      suite: quoi === "candidature" ? "For the next steps, please contact " + c.nom + ":" : "To agree on the date, programme and price, please contact " + c.nom + ":",
      repondre: "You can also simply reply to this email.", fin: "See you soon on the Butte," },
    es: { sujet: quoi === "candidature" ? "Tu candidatura a ArtDive está aceptada" : "Tu solicitud privada está aceptada",
      bonjour: "Hola " + nom + ",",
      intro: quoi === "candidature" ? "Buenas noticias: tu candidatura para unirte a ArtDive está aceptada." : "Buenas noticias: tu solicitud de visita o taller privado está aceptada.",
      suite: quoi === "candidature" ? "Para los siguientes pasos, contacta con " + c.nom + ":" : "Para fijar juntos la fecha, el programa y el precio, contacta con " + c.nom + ":",
      repondre: "También puedes responder a este email.", fin: "¡Hasta pronto en la Butte!" },
  }[l];
  const corps = "<p>" + esc(t.bonjour) + "</p><p>" + esc(t.intro) + "</p><p>" + esc(t.suite) + "<br><strong>" + esc(c.nom) + "</strong><br>" +
    '<a href="tel:+33' + c.tel.replace(/\s/g, "").slice(1) + '">' + esc(c.tel) + '</a><br><a href="mailto:' + c.email + '">' + esc(c.email) + "</a></p>" +
    "<p>" + esc(t.repondre) + "</p><p>" + esc(t.fin) + "<br>Mouvement Montmartre</p>";
  const html = cadre(corps);
  return { sujet: t.sujet, html, texte: versTexte(html) };
}

module.exports = { rediger, redigerInvitation, redigerAcces, redigerAcceptation, ics, esc, duree };
